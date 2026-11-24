use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Manager, RunEvent, State, WindowEvent};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const MAX_LOG_LINES: usize = 120;

#[derive(Clone, Serialize)]
pub struct BackendDiagnostics {
    pub base_url: String,
    pub mode: String,
    pub status: String,
    pub last_error: Option<String>,
    pub data_dir: String,
    pub logs: Vec<String>,
    pub pid: Option<u32>,
}

struct BackendState {
    base_url: Mutex<String>,
    data_dir: PathBuf,
    mode: Mutex<String>,
    status: Mutex<String>,
    last_error: Mutex<Option<String>>,
    logs: Arc<Mutex<VecDeque<String>>>,
    child: Mutex<Option<Child>>,
}

impl BackendState {
    fn snapshot(&self) -> BackendDiagnostics {
        let base_url = self.base_url.lock().map(|g| g.clone()).unwrap_or_default();
        let mode = self.mode.lock().map(|g| g.clone()).unwrap_or_else(|_| "unknown".into());
        let mut status = self.status.lock().map(|g| g.clone()).unwrap_or_else(|_| "unknown".into());
        let mut last_error = self.last_error.lock().ok().and_then(|g| g.clone());
        let logs = self
            .logs
            .lock()
            .map(|g| g.iter().cloned().collect())
            .unwrap_or_default();

        let mut pid = None;
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(exit_status)) => {
                        if status == "starting" || status == "running" {
                            let msg = format!(
                                "Backend process exited unexpectedly with status: {exit_status}"
                            );
                            status = "failed".into();
                            if last_error.is_none() {
                                last_error = Some(msg.clone());
                            }
                            if let Ok(mut st) = self.status.lock() {
                                *st = "failed".into();
                            }
                            if let Ok(mut le) = self.last_error.lock() {
                                if le.is_none() {
                                    *le = Some(msg.clone());
                                }
                            }
                            push_log(&self.logs, format!("[host] ERROR: {msg}"));
                        }
                        *guard = None;
                    }
                    Ok(None) => {
                        pid = Some(child.id());
                        if status == "starting" {
                            status = "running".into();
                        }
                    }
                    Err(err) => {
                        let msg = format!("Failed to query backend process state: {err}");
                        status = "failed".into();
                        last_error = Some(msg.clone());
                        if let Ok(mut st) = self.status.lock() {
                            *st = "failed".into();
                        }
                        if let Ok(mut le) = self.last_error.lock() {
                            *le = Some(msg);
                        }
                    }
                }
            }
        }

        BackendDiagnostics {
            base_url,
            mode,
            status,
            last_error,
            data_dir: self.data_dir.to_string_lossy().into_owned(),
            logs,
            pid,
        }
    }

    fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                terminate_child(&mut child);
            }
        }
        if let Ok(mut status) = self.status.lock() {
            if *status != "failed" {
                *status = "stopped".into();
            }
        }
    }
}

impl Drop for BackendState {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn push_log(logs: &Arc<Mutex<VecDeque<String>>>, line: String) {
    if let Ok(mut guard) = logs.lock() {
        if guard.len() >= MAX_LOG_LINES {
            guard.pop_front();
        }
        guard.push_back(line);
    }
}

fn attach_log_reader<R: std::io::Read + Send + 'static>(
    reader: R,
    tag: &'static str,
    logs: Arc<Mutex<VecDeque<String>>>,
) {
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        for line in buf.lines().map_while(Result::ok) {
            let trimmed = line.trim_end().to_string();
            if !trimmed.is_empty() {
                #[cfg(debug_assertions)]
                eprintln!("[backend:{tag}] {trimmed}");
                push_log(&logs, format!("[{tag}] {trimmed}"));
            }
        }
    });
}

fn terminate_child(child: &mut Child) {
    if let Ok(Some(_)) = child.try_wait() {
        return;
    }

    #[cfg(unix)]
    {
        let pid = child.id().to_string();
        let _ = Command::new("kill")
            .args(["-TERM", &pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pid = child.id().to_string();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    let _ = child.wait();
}

fn pick_available_port(preferred: u16) -> u16 {
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", preferred)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    if let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    preferred
}

fn locate_backend_dir() -> Option<PathBuf> {
    let candidates = [
        std::env::current_dir().ok().map(|p| p.join("backend")),
        std::env::current_dir()
            .ok()
            .and_then(|p| p.parent().map(|pp| pp.join("backend"))),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.join("backend"))),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().and_then(|p| p.parent()).map(|p| p.join("Resources").join("backend"))),
    ];

    candidates.into_iter().flatten().find(|p| p.join("app").join("main.py").exists())
}

fn sidecar_binary_names() -> Vec<String> {
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    };
    let triple_suffix = if cfg!(target_os = "macos") {
        format!("{arch}-apple-darwin")
    } else if cfg!(target_os = "windows") {
        format!("{arch}-pc-windows-msvc")
    } else {
        format!("{arch}-unknown-linux-gnu")
    };

    vec![
        format!("research-ide-backend{ext}"),
        format!("research-ide-backend-{triple_suffix}{ext}"),
    ]
}

fn locate_bundled_sidecar() -> Option<PathBuf> {
    let names = sidecar_binary_names();
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.to_path_buf());
            dirs.push(parent.join("binaries"));
            if let Some(grand) = parent.parent() {
                dirs.push(grand.join("Resources"));
                dirs.push(grand.join("Resources").join("binaries"));
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("src-tauri").join("binaries"));
        dirs.push(cwd.join("binaries"));
        if let Some(parent) = cwd.parent() {
            dirs.push(parent.join("src-tauri").join("binaries"));
        }
    }

    for dir in dirs {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn locate_python_executable(backend_dir: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        let venv_win = backend_dir.join(".venv").join("Scripts").join("python.exe");
        if venv_win.exists() {
            return venv_win.to_string_lossy().into_owned();
        }
        "python".to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let venv_unix = backend_dir.join(".venv").join("bin").join("python");
        if venv_unix.exists() {
            return venv_unix.to_string_lossy().into_owned();
        }
        "python3".to_string()
    }
}

fn apply_common_env(cmd: &mut Command, app_data_dir: &Path, port: u16, logs: &Arc<Mutex<VecDeque<String>>>) {
    cmd.env("RESEARCH_IDE_DATA_DIR", app_data_dir)
        .env("RESEARCH_IDE_API_HOST", "127.0.0.1")
        .env("RESEARCH_IDE_API_PORT", port.to_string())
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    push_log(
        logs,
        format!("[host] Launching backend on 127.0.0.1:{port} (data_dir={})", app_data_dir.display()),
    );
}

fn spawn_backend_process(
    app_data_dir: &Path,
    port: u16,
    logs: &Arc<Mutex<VecDeque<String>>>,
) -> (String, String, Option<String>, Option<Child>) {
    if std::env::var("RESEARCH_IDE_EXTERNAL_BACKEND").as_deref() == Ok("1") {
        return ("external".into(), "running".into(), None, None);
    }

    let prefer_sidecar = !cfg!(debug_assertions)
        || std::env::var("RESEARCH_IDE_USE_SIDECAR").as_deref() == Ok("1");

    let mut cmd_opt: Option<(String, Command)> = None;

    if let Ok(custom_bin) = std::env::var("RESEARCH_IDE_BACKEND_BIN") {
        let trimmed = custom_bin.trim();
        if !trimmed.is_empty() {
            let mut c = Command::new(trimmed);
            c.args(["--host", "127.0.0.1", "--port", &port.to_string()]);
            cmd_opt = Some(("bundled_sidecar".into(), c));
        }
    }

    if cmd_opt.is_none() && prefer_sidecar {
        if let Some(sidecar_path) = locate_bundled_sidecar() {
            let mut c = Command::new(&sidecar_path);
            c.args(["--host", "127.0.0.1", "--port", &port.to_string()]);
            cmd_opt = Some(("bundled_sidecar".into(), c));
        }
    }

    if cmd_opt.is_none() {
        if let Some(backend_dir) = locate_backend_dir() {
            let python_bin = locate_python_executable(&backend_dir);
            let mut c = Command::new(python_bin);
            c.current_dir(&backend_dir).args([
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
            ]);
            cmd_opt = Some(("dev_python".into(), c));
        } else if let Some(sidecar_path) = locate_bundled_sidecar() {
            let mut c = Command::new(&sidecar_path);
            c.args(["--host", "127.0.0.1", "--port", &port.to_string()]);
            cmd_opt = Some(("bundled_sidecar".into(), c));
        }
    }

    let Some((mode, mut cmd)) = cmd_opt else {
        let err = "Could not locate bundled research-ide-backend binary or development backend directory.".to_string();
        push_log(logs, format!("[host] ERROR: {err}"));
        return ("bundled_sidecar".into(), "failed".into(), Some(err), None);
    };

    apply_common_env(&mut cmd, app_data_dir, port, logs);

    match cmd.spawn() {
        Ok(mut child) => {
            if let Some(stdout) = child.stdout.take() {
                attach_log_reader(stdout, "stdout", Arc::clone(logs));
            }
            if let Some(stderr) = child.stderr.take() {
                attach_log_reader(stderr, "stderr", Arc::clone(logs));
            }
            (mode, "starting".into(), None, Some(child))
        }
        Err(err) => {
            let msg = format!("Failed to spawn backend ({mode}): {err}");
            push_log(logs, format!("[host] ERROR: {msg}"));
            (mode, "failed".into(), Some(msg), None)
        }
    }
}

#[tauri::command]
fn get_backend_url(state: State<BackendState>) -> String {
    state.base_url.lock().map(|g| g.clone()).unwrap_or_default()
}

#[tauri::command]
fn get_backend_diagnostics(state: State<BackendState>) -> BackendDiagnostics {
    state.snapshot()
}

#[tauri::command]
fn restart_backend(state: State<BackendState>) -> BackendDiagnostics {
    state.shutdown();

    let port = if std::env::var("RESEARCH_IDE_EXTERNAL_BACKEND").as_deref() == Ok("1") {
        std::env::var("RESEARCH_IDE_API_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(8765)
    } else {
        pick_available_port(8765)
    };

    let (mode, status, last_error, child) =
        spawn_backend_process(&state.data_dir, port, &state.logs);
    let base_url = format!("http://127.0.0.1:{port}/api/v1");

    if let Ok(mut guard) = state.base_url.lock() {
        *guard = base_url;
    }
    if let Ok(mut guard) = state.mode.lock() {
        *guard = mode;
    }
    if let Ok(mut guard) = state.status.lock() {
        *guard = status;
    }
    if let Ok(mut guard) = state.last_error.lock() {
        *guard = last_error;
    }
    if let Ok(mut guard) = state.child.lock() {
        *guard = child;
    }

    state.snapshot()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("academic-research-ide"));
            let _ = std::fs::create_dir_all(&data_dir);

            let port = if std::env::var("RESEARCH_IDE_EXTERNAL_BACKEND").as_deref() == Ok("1") {
                std::env::var("RESEARCH_IDE_API_PORT")
                    .ok()
                    .and_then(|p| p.parse::<u16>().ok())
                    .unwrap_or(8765)
            } else {
                pick_available_port(8765)
            };

            let logs = Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES)));
            let (mode, status, last_error, child) = spawn_backend_process(&data_dir, port, &logs);
            let base_url = format!("http://127.0.0.1:{port}/api/v1");

            app.manage(BackendState {
                base_url: Mutex::new(base_url),
                data_dir,
                mode: Mutex::new(mode),
                status: Mutex::new(status),
                last_error: Mutex::new(last_error),
                logs,
                child: Mutex::new(child),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<BackendState>() {
                    state.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_url,
            get_backend_diagnostics,
            restart_backend
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<BackendState>() {
                state.shutdown();
            }
        }
        _ => {}
    });
}
