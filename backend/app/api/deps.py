from __future__ import annotations

from fastapi import Request

from app.core.config import Settings
from app.db.sqlite import ResearchRepository, SQLiteDatabase
from app.db.vector_store import EmbeddingProvider, VectorStore
from app.pipeline.worker import IngestionManager
from app.services.critic_service import CriticService
from app.services.graph_service import GraphService
from app.services.style_service import StyleService


def get_settings(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


def get_db(request: Request) -> SQLiteDatabase:
    return request.app.state.db  # type: ignore[no-any-return]


def get_repo(request: Request) -> ResearchRepository:
    return request.app.state.repo  # type: ignore[no-any-return]


def get_vector_store(request: Request) -> VectorStore:
    return request.app.state.vector_store  # type: ignore[no-any-return]


def get_embedder(request: Request) -> EmbeddingProvider:
    return request.app.state.embedder  # type: ignore[no-any-return]


def get_ingestion_manager(request: Request) -> IngestionManager:
    return request.app.state.ingestion_manager  # type: ignore[no-any-return]


def get_graph_service(request: Request) -> GraphService:
    return request.app.state.graph_service  # type: ignore[no-any-return]


def get_style_service(request: Request) -> StyleService:
    return request.app.state.style_service  # type: ignore[no-any-return]


def get_critic_service(request: Request) -> CriticService:
    return request.app.state.critic_service  # type: ignore[no-any-return]
