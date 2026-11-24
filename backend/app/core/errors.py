from __future__ import annotations

import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

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
    """Attach a per-request UUID to request.state and X-Request-ID header."""

    async def dispatch(self, request: Request, call_next: Any) -> Any:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


def _get_request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def register_exception_handlers(app: FastAPI) -> None:
    """Register canonical ApiError handlers for all exceptions."""

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        payload = ApiError(
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
            request_id=_get_request_id(request),
        )
        return JSONResponse(status_code=exc.status_code, content=payload.model_dump())

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        payload = ApiError(
            error_code="VALIDATION_ERROR",
            message="İstek parametreleri sözleşmeye uygun değil.",
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
        payload = ApiError(
            error_code="INTERNAL_SERVER_ERROR",
            message="Beklenmeyen sunucu hatası oluştu.",
            details={"exception_type": type(exc).__name__, "detail": str(exc)},
            request_id=_get_request_id(request),
        )
        return JSONResponse(status_code=500, content=payload.model_dump())
