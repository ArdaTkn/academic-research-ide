from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import get_critic_service, get_repo, get_request_locale, get_style_service
from app.core.i18n import Locale
from app.db.sqlite import ResearchRepository
from app.models.schemas import (
    AuditFinding,
    AuditParagraphRequest,
    AuditResult,
    DeleteDraftResponse,
    DismissFindingRequest,
    Draft,
    DraftCreateRequest,
    DraftUpdateRequest,
    StyleExtractRequest,
    StyleProfile,
)
from app.services.critic_service import CriticService
from app.services.style_service import StyleService

router = APIRouter(tags=["drafts"])


@router.get("/style-profiles", response_model=list[StyleProfile])
def list_style_profiles(repo: ResearchRepository = Depends(get_repo)) -> list[StyleProfile]:
    return repo.list_style_profiles()


@router.post("/style-profiles/extract", response_model=StyleProfile, status_code=status.HTTP_201_CREATED)
def extract_style_profile(
    body: StyleExtractRequest,
    locale: Locale = Depends(get_request_locale),
    style_service: StyleService = Depends(get_style_service),
) -> StyleProfile:
    return style_service.extract_style_profile(body, locale=locale)


@router.patch("/style-profiles/{profile_id}/activate", response_model=StyleProfile)
def activate_style_profile(
    profile_id: str,
    repo: ResearchRepository = Depends(get_repo),
) -> StyleProfile:
    return repo.activate_style_profile(profile_id)


@router.get("/drafts", response_model=list[Draft])
def list_drafts(repo: ResearchRepository = Depends(get_repo)) -> list[Draft]:
    return repo.list_drafts()


@router.post("/drafts", response_model=Draft, status_code=status.HTTP_201_CREATED)
def create_draft(
    body: DraftCreateRequest,
    repo: ResearchRepository = Depends(get_repo),
) -> Draft:
    return repo.create_draft(
        title=body.title.strip(),
        content_markdown=body.content_markdown,
        style_profile_id=body.style_profile_id,
    )


@router.get("/drafts/{draft_id}", response_model=Draft)
def get_draft(draft_id: str, repo: ResearchRepository = Depends(get_repo)) -> Draft:
    return repo.get_draft(draft_id)


@router.put("/drafts/{draft_id}", response_model=Draft)
def update_draft(
    draft_id: str,
    body: DraftUpdateRequest,
    repo: ResearchRepository = Depends(get_repo),
) -> Draft:
    return repo.update_draft(
        draft_id,
        title=body.title,
        content_markdown=body.content_markdown,
        style_profile_id=body.style_profile_id,
    )


@router.delete("/drafts/{draft_id}", response_model=DeleteDraftResponse)
def delete_draft(draft_id: str, repo: ResearchRepository = Depends(get_repo)) -> DeleteDraftResponse:
    repo.delete_draft(draft_id)
    return DeleteDraftResponse(deleted=True, draft_id=draft_id)


@router.get("/drafts/{draft_id}/audits", response_model=list[AuditResult])
def list_draft_audits(
    draft_id: str,
    repo: ResearchRepository = Depends(get_repo),
) -> list[AuditResult]:
    return repo.list_draft_audits(draft_id)


@router.post("/drafts/{draft_id}/audit", response_model=AuditResult)
def audit_draft_paragraph(
    draft_id: str,
    body: AuditParagraphRequest,
    locale: Locale = Depends(get_request_locale),
    critic_service: CriticService = Depends(get_critic_service),
) -> AuditResult:
    return critic_service.audit_paragraph(draft_id, body, locale=locale)


@router.patch("/audit-findings/{finding_id}/dismiss", response_model=AuditFinding)
def dismiss_audit_finding(
    finding_id: str,
    body: DismissFindingRequest,
    repo: ResearchRepository = Depends(get_repo),
) -> AuditFinding:
    return repo.dismiss_audit_finding(finding_id, body.is_dismissed)
