import json
import logging
import logging.config
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.middleware.rate_limit import limiter


# ── Structured JSON logging configuration ──
class JSONFormatter(logging.Formatter):
    """Emit log records as single-line JSON for SIEM ingestion."""
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "ts": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0]:
            log_data["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_data, ensure_ascii=False)


_log_config = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": JSONFormatter},
        "standard": {"format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json" if not settings.DEBUG else "standard",
        },
    },
    "loggers": {
        "chaticu": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "chaticu.audit": {"level": "INFO", "handlers": ["console"], "propagate": False},
        "uvicorn": {"level": "INFO", "handlers": ["console"], "propagate": False},
    },
}
logging.config.dictConfig(_log_config)
logger = logging.getLogger("chaticu")
from app.routers import (
    admin,
    ai_chat,
    auth,
    clinical,
    dashboard,
    health,
    lab_data,
    medications,
    messages,
    patients,
    pharmacy,
    rag,
    rules,
    team_chat,
    ventilator,
    vital_signs,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")

    # Auto-index RAG documents if path is configured
    if settings.RAG_DOCS_PATH:
        from app.services.llm_services.rag_service import rag_service
        try:
            chunks = rag_service.load_and_chunk(settings.RAG_DOCS_PATH)
            result = rag_service.index(chunks)
            print(f"RAG indexed: {result['total_chunks']} chunks from {result.get('total_documents', 0)} documents")
        except Exception as e:
            print(f"RAG indexing skipped (non-fatal): {e}")

    yield
    # Shutdown
    from app.middleware.auth import _redis_client
    if _redis_client:
        await _redis_client.close()
    print("Shutting down...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── HSTS (T15) — Strict-Transport-Security header in production ──
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses (T15 HSTS + T26 XSS/clickjack protection)."""
    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[override]
        response = await call_next(request)
        if not settings.DEBUG:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        # Always set defensive headers (dev + prod)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # DAST hardening: mitigate Spectre/cacheable-content findings.
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


app.add_middleware(SecurityHeadersMiddleware)


# ── Global Exception Handlers ─────────────────────────────────────────
# Ensures ALL error responses follow: {success: false, error: ..., message: ...}

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": _status_to_error_code(exc.status_code),
            "message": exc.detail if isinstance(exc.detail, str) else str(exc.detail),
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    field = " → ".join(str(loc) for loc in first.get("loc", []))
    msg = first.get("msg", "Validation error")
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": "VALIDATION_ERROR",
            "message": f"{field}: {msg}" if field else msg,
            "details": [
                {"field": " → ".join(str(loc) for loc in e.get("loc", [])), "message": e.get("msg", "")}
                for e in errors
            ],
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    error_id = uuid.uuid4().hex[:12]
    logger.error(
        "Unhandled exception [error_id=%s] %s: %s",
        error_id, type(exc).__name__, exc,
        exc_info=True,
    )

    # T28: Severe error alerting — log structured alert for SIEM/webhook integration
    _emit_severe_error_alert(error_id, request, exc)

    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "INTERNAL_SERVER_ERROR",
            "errorId": error_id,
            "message": "An unexpected error occurred" if not settings.DEBUG else str(exc),
        },
    )


def _emit_severe_error_alert(error_id: str, request: Request, exc: Exception) -> None:
    """Emit structured alert for 500 errors. Webhook delivery is configurable via
    ALERT_WEBHOOK_URL env var. Without a webhook, the alert is written to the
    structured log (picked up by log aggregators / SIEM)."""
    import traceback as _tb

    alert_payload = {
        "event": "severe_error",
        "error_id": error_id,
        "exception": type(exc).__name__,
        "message": str(exc)[:500],
        "path": str(request.url.path),
        "method": request.method,
        "traceback": _tb.format_exc()[:2000],
    }

    # Always log as structured JSON (SIEM can alert on event=severe_error)
    logger.critical(json.dumps(alert_payload, ensure_ascii=False))

    # Optional: fire webhook (Slack / PagerDuty / email gateway)
    webhook_url = getattr(settings, "ALERT_WEBHOOK_URL", "") or ""
    if webhook_url:
        import httpx
        try:
            httpx.post(webhook_url, json=alert_payload, timeout=5.0)
        except Exception:
            logger.warning("Failed to send alert webhook to %s", webhook_url)


def _status_to_error_code(status_code: int) -> str:
    return {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "VALIDATION_ERROR",
        429: "RATE_LIMIT_EXCEEDED",
        500: "INTERNAL_SERVER_ERROR",
        503: "SERVICE_UNAVAILABLE",
    }.get(status_code, f"HTTP_{status_code}")


# Include routers
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(lab_data.router)
app.include_router(vital_signs.router)
app.include_router(ventilator.router)
app.include_router(medications.router)
app.include_router(messages.router)
app.include_router(team_chat.router)
app.include_router(dashboard.router)
app.include_router(admin.router)
app.include_router(pharmacy.router)

# Phase 3: AI / RAG / Rules
app.include_router(clinical.router)
app.include_router(rag.router)
app.include_router(rules.router)
app.include_router(ai_chat.router)
