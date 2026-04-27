import asyncio
import json
import logging
import logging.config
import os
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

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
    admin_his_sync,
    ai_chat,
    ai_readiness,
    auth,
    clinical,
    dashboard,
    diagnostic_reports,
    discharge_check,
    fhir_export,
    health,
    lab_data,
    medication_duplicates,
    medications,
    message_activity,
    messages,
    notifications,
    patients,
    patients_v2,
    pharmacy,
    rag,
    record_templates,
    rules,
    scores,
    symptom_records,
    sync_status,
    team_chat,
    ventilator,
    vital_signs,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    mode_source = "default"
    mode_source_value = ""
    env_mode = (os.getenv("DATA_SOURCE_MODE") or "").strip()
    if env_mode:
        mode_source = "env"
        mode_source_value = env_mode
    else:
        env_file = settings.model_config.get("env_file")
        env_path = Path(str(env_file)) if env_file else None
        if env_path and env_path.exists():
            for raw in env_path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                if key.strip() == "DATA_SOURCE_MODE":
                    mode_source = str(env_path)
                    mode_source_value = value.strip().strip('"').strip("'")
                    break
    logger.info(
        "[INTG][DB] Startup data source mode=%s source=%s source_value=%s",
        settings.DATA_SOURCE_MODE,
        mode_source,
        mode_source_value or "n/a",
    )
    if mode_source == "default":
        logger.warning(
            "[INTG][DB] DATA_SOURCE_MODE not explicitly configured; using default=%s",
            settings.DATA_SOURCE_MODE,
        )
    if settings.DATA_SOURCE_MODE == "json":
        from seeds.validate_datamock import validate_datamock

        validation_report = validate_datamock(raise_on_error=True)
        logger.warning(
            "[INTG][DB] DATA_SOURCE_MODE=json enabled. "
            "Datamock validation passed: %s",
            validation_report,
        )

    startup_warmup_task: asyncio.Task | None = None

    # Run non-critical startup work in the background. Railway already runs
    # Alembic before boot; these fallback migrations and RAG warmup are
    # best-effort and must not block /health or turn the whole API into 502s.
    async def _run_startup_warmups() -> None:
        try:
            from app.database import engine
            from app.startup_migrations import run_all as run_startup_migrations

            await run_startup_migrations(engine)
        except asyncio.CancelledError:
            logger.info("[INTG][DB] Startup warmups cancelled during shutdown")
            raise
        except Exception as e:
            logger.warning("[INTG][DB] Startup migrations failed (non-fatal): %s", e)

        if not getattr(settings, "RAG_AUTO_INDEX_ON_STARTUP", True):
            return

        from app.services.llm_services.rag_service import rag_service

        try:
            if await rag_service.load_persisted():
                if settings.RAG_DOCS_PATH and await rag_service._needs_rebuild(settings.RAG_DOCS_PATH):
                    logger.info("[INTG][RAG] Source documents changed, rebuilding index")
                    chunks = rag_service.load_and_chunk(settings.RAG_DOCS_PATH)
                    result = await rag_service.index(chunks)
                    logger.info("[INTG][RAG] Rebuilt index: %d chunks", result["total_chunks"])
                else:
                    logger.info("[INTG][RAG] Persisted index is up-to-date (%d chunks)", len(rag_service.chunks))
            elif settings.RAG_DOCS_PATH:
                logger.info("[INTG][RAG] Building index from %s", settings.RAG_DOCS_PATH)
                chunks = rag_service.load_and_chunk(settings.RAG_DOCS_PATH)
                result = await rag_service.index(chunks)
                logger.info("[INTG][RAG] Built index: %d chunks", result["total_chunks"])
            else:
                logger.info("[INTG][RAG] No RAG_DOCS_PATH and no persisted index")
        except asyncio.CancelledError:
            logger.info("[INTG][RAG] Warmup cancelled during shutdown")
            raise
        except Exception as e:
            logger.warning("[INTG][RAG] Auto-indexing failed (non-fatal): %s", e)

    startup_warmup_task = asyncio.create_task(_run_startup_warmups(), name="startup-warmups")
    app.state.startup_warmup_task = startup_warmup_task
    logger.info("[INTG][DB] Startup warmups scheduled in background")

    yield
    # Shutdown
    task = getattr(app.state, "startup_warmup_task", None)
    if task and not task.done():
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    from app.middleware.auth import _redis_client
    if _redis_client:
        await _redis_client.close()
    print("Shutting down...")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url="/redoc" if settings.DEBUG else None,
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
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
        trace_id = request.headers.get("X-Trace-ID") or request_id
        request.state.request_id = request_id
        request.state.trace_id = trace_id

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
        # Content-Security-Policy — strict for API; relaxed in DEBUG for /docs
        if settings.DEBUG:
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                "font-src 'self'; frame-ancestors 'none'"
            )
        else:
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; script-src 'none'; style-src 'none'; "
                "img-src 'none'; font-src 'none'; connect-src 'none'; "
                "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            )
        # DAST hardening: mitigate Spectre/cacheable-content findings.
        #
        # In local dev the frontend runs on a different origin (different port),
        # so CORP=same-origin can break browser XHR/fetch (appears as "Network Error").
        response.headers["Cross-Origin-Resource-Policy"] = (
            "cross-origin" if settings.DEBUG else "same-origin"
        )
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Trace-ID"] = trace_id
        return response


app.add_middleware(SecurityHeadersMiddleware)


def _request_id_from_request(request: Request) -> str:
    return getattr(request.state, "request_id", None) or request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]


def _trace_id_from_request(request: Request) -> str:
    return getattr(request.state, "trace_id", None) or request.headers.get("X-Trace-ID") or _request_id_from_request(request)


# ── Global Exception Handlers ─────────────────────────────────────────
# Ensures ALL error responses follow: {success: false, error: ..., message: ...}

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = _request_id_from_request(request)
    trace_id = _trace_id_from_request(request)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": _status_to_error_code(exc.status_code),
            "message": exc.detail if isinstance(exc.detail, str) else str(exc.detail),
            "request_id": request_id,
            "trace_id": trace_id,
        },
        headers={"X-Request-ID": request_id, "X-Trace-ID": trace_id},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = _request_id_from_request(request)
    trace_id = _trace_id_from_request(request)
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
            "request_id": request_id,
            "trace_id": trace_id,
        },
        headers={"X-Request-ID": request_id, "X-Trace-ID": trace_id},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    error_id = uuid.uuid4().hex[:12]
    request_id = _request_id_from_request(request)
    trace_id = _trace_id_from_request(request)
    logger.error(
        "[INTG][API] Unhandled exception [error_id=%s request_id=%s trace_id=%s] %s: %s",
        error_id, request_id, trace_id, type(exc).__name__, exc,
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
            "request_id": request_id,
            "trace_id": trace_id,
            "message": "An unexpected error occurred" if not settings.DEBUG else str(exc),
        },
        headers={"X-Request-ID": request_id, "X-Trace-ID": trace_id},
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
        "request_id": _request_id_from_request(request),
        "trace_id": _trace_id_from_request(request),
        "traceback": _tb.format_exc()[:2000],
    }

    # Always log as structured JSON (SIEM can alert on event=severe_error)
    logger.critical(json.dumps(alert_payload, ensure_ascii=False))

    # Optional: fire webhook (Slack / PagerDuty / email gateway)
    webhook_url = getattr(settings, "ALERT_WEBHOOK_URL", "") or ""
    if webhook_url:
        import asyncio
        import httpx

        def _send_webhook():
            try:
                httpx.post(webhook_url, json=alert_payload, timeout=5.0)
            except Exception:
                logger.warning("[INTG][API] Failed to send alert webhook to %s", webhook_url)

        try:
            asyncio.get_event_loop().run_in_executor(None, _send_webhook)
        except Exception:
            logger.warning("[INTG][API] Failed to schedule alert webhook")


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
app.include_router(diagnostic_reports.router)
app.include_router(vital_signs.router)
app.include_router(ventilator.router)
app.include_router(medications.router)
app.include_router(medication_duplicates.router)
app.include_router(medication_duplicates.pharmacy_summary_router)
app.include_router(discharge_check.router)
app.include_router(fhir_export.router)
app.include_router(message_activity.router)  # before messages — /patients/messages/* must match before /patients/{patient_id}/messages
app.include_router(messages.router)
app.include_router(notifications.router)
app.include_router(team_chat.router)
app.include_router(team_chat.users_router)
app.include_router(dashboard.router)
app.include_router(admin.router)
app.include_router(admin_his_sync.router)
app.include_router(pharmacy.router)

# Phase 3: AI / RAG / Rules
app.include_router(ai_chat.router)
app.include_router(clinical.router)
app.include_router(ai_readiness.router)
app.include_router(rag.router)
app.include_router(rules.router)
# Phase 4: V2 endpoints + Clinical Scores
app.include_router(patients_v2.router)
app.include_router(scores.router)
app.include_router(record_templates.router)
app.include_router(symptom_records.router)
app.include_router(sync_status.router)
