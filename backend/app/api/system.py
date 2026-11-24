from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_db, get_settings, get_vector_store
from app.core.config import Settings
from app.db.sqlite import SQLiteDatabase
from app.db.vector_store import OpenAICompatibleEmbedder, VectorStore
from app.models.schemas import ConfigPatchRequest, ConfigResponse, HealthResponse
from app.pipeline.llm_extractor import OpenAICompatibleLLMExtractor

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health(
    settings: Settings = Depends(get_settings),
    db: SQLiteDatabase = Depends(get_db),
    vector_store: VectorStore = Depends(get_vector_store),
) -> HealthResponse:
    sqlite_ok = db.health_check()
    lancedb_ok = vector_store.health_check()
    status = "ok" if (sqlite_ok and lancedb_ok) else "degraded"
    return HealthResponse(
        status=status,
        version=settings.app_version,
        sqlite_ok=sqlite_ok,
        lancedb_ok=lancedb_ok,
        active_llm_provider=settings.llm_provider,
        active_llm_model=settings.llm_model,
    )


@router.get("/config", response_model=ConfigResponse)
def get_config(settings: Settings = Depends(get_settings)) -> ConfigResponse:
    return ConfigResponse(**settings.public_dict())


@router.patch("/config", response_model=ConfigResponse)
def patch_config(
    patch: ConfigPatchRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ConfigResponse:
    patch_dict = patch.model_dump(exclude_none=True)
    if patch_dict:
        settings.save_persisted_overrides(patch_dict)
        # Aktif LLM/Embedder istemcilerini güncelle (özel test stub'ı yoksa)
        manager = getattr(request.app.state, "ingestion_manager", None)
        if manager is not None and not getattr(request.app.state, "preserve_custom_providers", False):
            manager.llm_extractor = OpenAICompatibleLLMExtractor(
                base_url=settings.llm_base_url,
                model=settings.llm_model,
                api_key=settings.llm_api_key,
            )
            emb_url = settings.embedding_base_url or settings.llm_base_url
            embedder = OpenAICompatibleEmbedder(
                base_url=emb_url,
                model=settings.embedding_model,
                api_key=settings.llm_api_key,
                dim=settings.embedding_dim,
            )
            request.app.state.embedder = embedder
            manager.embedder = embedder
            if hasattr(request.app.state, "style_service"):
                request.app.state.style_service.embedder = embedder
            if hasattr(request.app.state, "critic_service"):
                request.app.state.critic_service.embedder = embedder
    return ConfigResponse(**settings.public_dict())
