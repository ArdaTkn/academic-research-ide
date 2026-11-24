from __future__ import annotations

import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.i18n import Locale, resolve_locale, t
from app.models.schemas import ApiError


class AppError(Exception):
    """Base structured domain error converted to ApiError envelope."""

    def __init__(
        self,
        *,
        status_code: int,
        error_code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.details = details or {}


class BadRequestError(AppError):
    def __init__(
        self,
        error_code: str = "BAD_REQUEST",
        message: str = "Geçersiz istek.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=400, error_code=error_code, message=message, details=details)


class NotFoundError(AppError):
    def __init__(
        self,
        error_code: str = "NOT_FOUND",
        message: str = "Kayıt bulunamadı.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=404, error_code=error_code, message=message, details=details)


class ConflictError(AppError):
    def __init__(
        self,
        error_code: str = "CONFLICT",
        message: str = "Kaynak çakışması.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=409, error_code=error_code, message=message, details=details)


class PDFExtractionError(AppError):
    def __init__(
        self,
        error_code: str = "PAPER_PARSE_FAILED",
        message: str = "PDF metni çıkarılamadı veya dosya bozuk.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=422, error_code=error_code, message=message, details=details)


class ExtractionValidationError(AppError):
    def __init__(
        self,
        error_code: str = "EXTRACTION_VALIDATION_FAILED",
        message: str = "Yapılandırılmış çıkarım sözleşme doğrulamasından geçemedi.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=422, error_code=error_code, message=message, details=details)


class ServiceUnavailableError(AppError):
    def __init__(
        self,
        error_code: str = "SERVICE_UNAVAILABLE",
        message: str = "Harici veya yerel model servisine erişilemiyor.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=503, error_code=error_code, message=message, details=details)


class NotImplementedFeatureError(AppError):
    def __init__(
        self,
        error_code: str = "NOT_IMPLEMENTED",
        message: str = "Bu özellik henüz aktif değil.",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(status_code=501, error_code=error_code, message=message, details=details)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a per-request UUID and resolved locale to request.state."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        settings = getattr(request.app.state, "settings", None)
        default_locale: Locale = getattr(settings, "ui_locale", "en") if settings else "en"
        request.state.locale = resolve_locale(
            explicit=request.query_params.get("locale"),
            accept_language=request.headers.get("Accept-Language"),
            default=default_locale,
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


def _get_request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _get_request_locale(request: Request) -> Locale:
    return getattr(request.state, "locale", "en")


_ERROR_CODE_I18N_KEYS: dict[str, str] = {
    "BAD_REQUEST": "err.bad_request",
    "NOT_FOUND": "err.not_found",
    "CONFLICT": "err.conflict",
    "PAPER_PARSE_FAILED": "err.pdf_parse_failed",
    "EXTRACTION_VALIDATION_FAILED": "err.extraction_validation_failed",
    "SERVICE_UNAVAILABLE": "err.service_unavailable",
    "NOT_IMPLEMENTED": "err.not_implemented",
    "NO_FILES_PROVIDED": "err.no_files",
    "INVALID_INGEST_REQUEST": "err.invalid_ingest",
    "STYLE_SOURCE_NOT_FOUND": "err.style_source_not_found",
    "NO_STYLE_TEXTS_PROVIDED": "err.no_style_texts",
    "PAPER_NOT_FOUND": "err.paper_not_found",
    "JOB_NOT_FOUND": "err.job_not_found",
    "VARIABLE_NOT_FOUND": "err.variable_not_found",
    "DRAFT_NOT_FOUND": "err.draft_not_found",
    "STYLE_PROFILE_NOT_FOUND": "err.style_profile_not_found",
    "AUDIT_FINDING_NOT_FOUND": "err.audit_finding_not_found",
    "DUPLICATE_PAPER": "err.duplicate_paper",
    "PDF_FILE_MISSING": "err.pdf_file_missing",
    "PDF_PAGE_OUT_OF_RANGE": "err.pdf_page_out_of_range",
    "PDF_RENDER_FAILED": "err.pdf_render_failed",
}


def register_exception_handlers(app: FastAPI) -> None:
    """Register canonical ApiError handlers for all exceptions."""

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        locale = _get_request_locale(request)
        i18n_key = _ERROR_CODE_I18N_KEYS.get(exc.error_code)
        message = t(locale, i18n_key) if i18n_key else exc.message
        payload = ApiError(
            error_code=exc.error_code,
            message=message,
            details=exc.details,
            request_id=_get_request_id(request),
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump())

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        locale = _get_request_locale(request)
        payload = ApiError(
            error_code="VALIDATION_ERROR",
            message=t(locale, "err.validation"),
            details={"errors": exc.errors()},
            request_id=_get_request_id(request),
        )
        return JSONResponse(status_code=422, content=payload.model_dump())

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        payload = ApiError(
            error_code=f"HTTP_{exc.status_code}",
            message=str(exc.detail),
            details={},
            request_id=_get_request_id(request),
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump())

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        locale = _get_request_locale(request)
        payload = ApiError(
            error_code="INTERNAL_SERVER_ERROR",
            message=t(locale, "err.internal"),
            details={"exception_type": type(exc).__name__, "detail": str(exc)},
            request_id=_get_request_id(request),
        )
        return JSONResponse(status_code=500, content=payload.model_dump())
