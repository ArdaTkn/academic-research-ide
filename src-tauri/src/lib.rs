use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

struct BackendState {
    base_url: String,
    child: Mutex<Option<Child>>,
}

impl BackendState {
    fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                terminate_child(&mut child);
            }
        }
    }
}

impl Drop for BackendState {
    fn drop(&mut self) {
        self.shutdown();
    }
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

fn locate_python_executable(backend_dir: &Path) -> String {
    if let Ok(custom) = std::env::var("RESEARCH_IDE_BACKEND_BIN") {
        if !custom.trim().is_empty() {
            return custom;
        }
    }

    #[cfg(target_os = "windows")]
    {
        let venv_win = backend_dir.join(".venv").join("Scripts").join("python.exe");
        if venv_win.exists() {
            return venv_win.to_string_lossy().into_owned();
        }
        return "python".to_string();
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

fn spawn_backend_sidecar(app_data_dir: &Path, port: u16) -> Option<Child> {
    if std::env::var("RESEARCH_IDE_EXTERNAL_BACKEND").as_deref() == Ok("1") {
        return None;
    }

    let backend_dir = locate_backend_dir()?;
    let python_bin = locate_python_executable(&backend_dir);

    let mut cmd = Command::new(python_bin);
    cmd.current_dir(&backend_dir)
        .args([
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .env("RESEARCH_IDE_DATA_DIR", app_data_dir)
        .env("RESEARCH_IDE_API_HOST", "127.0.0.1")
        .env("RESEARCH_IDE_API_PORT", port.to_string())
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn().ok()
}

#[tauri::command]
fn get_backend_url(state: State<BackendState>) -> String {
    state.base_url.clone()
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

            let child = spawn_backend_sidecar(&data_dir, port);
            let base_url = format!("http://127.0.0.1:{port}/api/v1");

            app.manage(BackendState {
                base_url,
                child: Mutex::new(child),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_url])
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
