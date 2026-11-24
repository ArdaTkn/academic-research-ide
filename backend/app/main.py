from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import drafts, graph, matrix, papers, system
from app.core.config import Settings
from app.core.errors import RequestIDMiddleware, register_exception_handlers
from app.db.sqlite import ResearchRepository, SQLiteDatabase
from app.db.vector_store import EmbeddingProvider, LocalHashEmbedder, OpenAICompatibleEmbedder, VectorStore
from app.pipeline.llm_extractor import LLMExtractor, OpenAICompatibleLLMExtractor
from app.pipeline.worker import IngestionManager
from app.services.critic_service import CriticService
from app.services.graph_service import GraphService
from app.services.style_service import StyleService


def _build_default_embedder(settings: Settings) -> EmbeddingProvider:
    if settings.embedding_provider == "local_hash":
        return LocalHashEmbedder(dim=settings.embedding_dim)
    return OpenAICompatibleEmbedder(
        base_url=settings.embedding_base_url or settings.llm_base_url,
        model=settings.embedding_model,
        api_key=settings.llm_api_key,
        dim=settings.embedding_dim,
    )


def create_app(
    *,
    settings: Settings | None = None,
    llm_extractor: LLMExtractor | None = None,
    embedder: EmbeddingProvider | None = None,
) -> FastAPI:
    active_settings = settings or Settings()

    db = SQLiteDatabase(active_settings.sqlite_path)
    repo = ResearchRepository(db)

    vector_store = VectorStore(
        lancedb_dir=active_settings.lancedb_dir,
        embedding_dim=active_settings.embedding_dim,
    )

    active_embedder = embedder or _build_default_embedder(active_settings)
    active_llm = llm_extractor or OpenAICompatibleLLMExtractor(
        base_url=active_settings.llm_base_url,
        model=active_settings.llm_model,
        api_key=active_settings.llm_api_key,
    )

    ingestion_manager = IngestionManager(
        repo=repo,
        vector_store=vector_store,
        llm_extractor=active_llm,
        embedder=active_embedder,
        pdfs_dir=active_settings.pdfs_dir,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        active_settings.ensure_data_dirs()
        active_settings.load_persisted_overrides()
        db.initialize()
        vector_store.initialize()
        yield

    application = FastAPI(
        title="Academic Research IDE Backend",
        version=active_settings.app_version,
        lifespan=lifespan,
    )

    application.state.settings = active_settings
    application.state.db = db
    application.state.repo = repo
    application.state.vector_store = vector_store
    application.state.embedder = active_embedder
    application.state.ingestion_manager = ingestion_manager
    application.state.graph_service = GraphService(repo)
    application.state.style_service = StyleService(repo, vector_store, active_embedder)
    application.state.critic_service = CriticService(repo, vector_store, active_embedder)
    application.state.preserve_custom_providers = (llm_extractor is not None or embedder is not None)

    application.add_middleware(RequestIDMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "*",
        ],
        allow_origin_regex=r"^(tauri://localhost|https?://(tauri\.localhost|localhost|127\.0\.0\.1)(:\d+)?)$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(application)

    api_prefix = "/api/v1"
    application.include_router(system.router, prefix=api_prefix)
    application.include_router(papers.router, prefix=api_prefix)
    application.include_router(graph.router, prefix=api_prefix)
    application.include_router(matrix.router, prefix=api_prefix)
    application.include_router(drafts.router, prefix=api_prefix)

    return application


app = create_app()
