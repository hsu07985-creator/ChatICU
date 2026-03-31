import json
import logging
import logging.config
import os
import uuid
from contextlib import asynccontextmanager
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
    ai_readiness,
    ai_chat,
    auth,
    clinical,
    dashboard,
    health,
    lab_data,
    medications,
    messages,
    patients,
    patients_v2,
    pharmacy,
    rag,
    rules,
    scores,
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

    # Ensure culture_results table exists (Alembic chain may skip 024/025)
    try:
        from app.database import engine
        from sqlalchemy import text as sa_text
        async with engine.begin() as conn:
            exists = await conn.scalar(sa_text(
                "SELECT EXISTS(SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='culture_results')"
            ))
            if not exists:
                logger.info("[INTG][DB] Creating culture_results table (migration 024 fallback)")
                await conn.execute(sa_text("""
                    CREATE TABLE culture_results (
                        id VARCHAR(50) PRIMARY KEY,
                        patient_id VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
                        sheet_number VARCHAR(50) NOT NULL,
                        specimen VARCHAR(100) NOT NULL,
                        specimen_code VARCHAR(20) NOT NULL,
                        department VARCHAR(100) NOT NULL DEFAULT '',
                        collected_at TIMESTAMPTZ,
                        reported_at TIMESTAMPTZ,
                        isolates JSONB,
                        susceptibility JSONB,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                """))
                await conn.execute(sa_text(
                    "CREATE INDEX IF NOT EXISTS ix_culture_results_patient_id ON culture_results(patient_id)"
                ))
                # Seed demo data
                import json, uuid
                seed_cultures = [
                    ("pat_001","M11411L014001","Sputum","SP01","加護病房一","2025-11-10T08:30:00+08:00","2025-11-13T14:00:00+08:00",
                     [{"code":"XORG1","organism":"Stenotrophomonas maltophilia"}],
                     [{"antibiotic":"Levofloxacin","code":"LVX","result":"S"},{"antibiotic":"Trimethoprim/Sulfamethoxazole","code":"SXT","result":"S"}]),
                    ("pat_001","M11411L014002","Sputum","SP01","加護病房一","2025-11-05T06:15:00+08:00","2025-11-08T10:30:00+08:00",
                     [{"code":"XORG2","organism":"Klebsiella pneumoniae"}],
                     [{"antibiotic":"Meropenem","code":"MEM","result":"S"},{"antibiotic":"Ceftazidime","code":"CAZ","result":"R"},
                      {"antibiotic":"Piperacillin/Tazobactam","code":"TZP","result":"I"},{"antibiotic":"Amikacin","code":"AMK","result":"S"}]),
                    ("pat_001","M11410L036001","Blood","BL01","加護病房一","2025-10-28T17:00:00+08:00","2025-10-31T13:00:00+08:00",[],[]),
                    ("pat_001","M11410L036002","Sputum","SP03","加護病房一","2025-10-25T09:00:00+08:00","2025-10-28T11:00:00+08:00",[],[]),
                    ("pat_002","M11411L020001","Blood","BL01","加護病房一","2025-11-12T03:00:00+08:00","2025-11-15T09:30:00+08:00",
                     [{"code":"XORG1","organism":"Escherichia coli"},{"code":"XORG2","organism":"Enterococcus faecalis"}],
                     [{"antibiotic":"Ampicillin","code":"AMP","result":"R"},{"antibiotic":"Ceftriaxone","code":"CRO","result":"S"},
                      {"antibiotic":"Ciprofloxacin","code":"CIP","result":"R"},{"antibiotic":"Meropenem","code":"MEM","result":"S"},
                      {"antibiotic":"Vancomycin","code":"VAN","result":"S"}]),
                    ("pat_002","M11411L020002","Urine(導尿)","UR024","加護病房一","2025-11-12T03:10:00+08:00","2025-11-14T16:00:00+08:00",
                     [{"code":"XORG1","organism":"Escherichia coli"}],
                     [{"antibiotic":"Ampicillin","code":"AMP","result":"R"},{"antibiotic":"Ceftriaxone","code":"CRO","result":"S"},
                      {"antibiotic":"Ciprofloxacin","code":"CIP","result":"R"},{"antibiotic":"Nitrofurantoin","code":"NIT","result":"S"}]),
                    ("pat_002","M11411L020003","Blood","BL01","加護病房一","2025-11-08T22:00:00+08:00","2025-11-11T14:00:00+08:00",[],[]),
                    ("pat_003","M11411L025001","Urine(導尿)","UR024","加護病房一","2025-11-14T10:00:00+08:00","2025-11-17T11:00:00+08:00",
                     [{"code":"XORG1","organism":"Candida albicans"}],
                     [{"antibiotic":"Fluconazole","code":"FCA","result":"S"},{"antibiotic":"Amphotericin B","code":"AMB","result":"S"},
                      {"antibiotic":"Caspofungin","code":"CAS","result":"S"}]),
                    ("pat_003","M11411L025002","Blood","BL01","加護病房一","2025-11-14T10:05:00+08:00","2025-11-17T15:00:00+08:00",[],[]),
                    ("pat_003","M11411L025003","Urine(導尿)","UR024","加護病房一","2025-11-08T08:00:00+08:00","2025-11-10T14:00:00+08:00",[],[]),
                    ("pat_004","M11411L030001","Wound","WD01","加護病房一","2025-11-15T14:00:00+08:00","2025-11-18T10:00:00+08:00",
                     [{"code":"XORG1","organism":"Staphylococcus aureus (MSSA)"}],
                     [{"antibiotic":"Oxacillin","code":"OXA","result":"S"},{"antibiotic":"Vancomycin","code":"VAN","result":"S"},
                      {"antibiotic":"Clindamycin","code":"CLI","result":"S"},{"antibiotic":"Trimethoprim/Sulfamethoxazole","code":"SXT","result":"S"}]),
                    ("pat_004","M11411L030002","CSF","CS01","加護病房一","2025-11-15T14:30:00+08:00","2025-11-18T16:00:00+08:00",[],[]),
                ]
                for pid, sheet, spec, scode, dept, col, rep, iso, susc in seed_cultures:
                    cid = f"culture_{uuid.uuid4().hex[:12]}"
                    await conn.execute(sa_text(
                        "INSERT INTO culture_results "
                        "(id,patient_id,sheet_number,specimen,specimen_code,department,"
                        "collected_at,reported_at,isolates,susceptibility,created_at,updated_at) "
                        "VALUES (:id,:pid,:sheet,:spec,:scode,:dept,"
                        "CAST(:col_at AS timestamptz),CAST(:rep_at AS timestamptz),CAST(:iso AS jsonb),CAST(:susc AS jsonb),NOW(),NOW())"
                    ).bindparams(id=cid,pid=pid,sheet=sheet,spec=spec,scode=scode,dept=dept,
                                 col_at=col,rep_at=rep,iso=json.dumps(iso),susc=json.dumps(susc)))
                logger.info("[INTG][DB] Seeded %d culture results", len(seed_cultures))
    except Exception as e:
        logger.warning("[INTG][DB] culture_results bootstrap failed (non-fatal): %s", e)

    # Fix swapped gender for pat_002/pat_003 (migration 026 fallback)
    try:
        from app.database import engine as _eng2
        from sqlalchemy import text as _t2
        async with _eng2.begin() as conn:
            # pat_002 (林小姐) should be 女
            await conn.execute(_t2(
                "UPDATE patients SET gender = '女' "
                "WHERE id = 'pat_002' AND gender = '男'"
            ))
            # pat_003 (林先生) should be 男
            await conn.execute(_t2(
                "UPDATE patients SET gender = '男' "
                "WHERE id = 'pat_003' AND gender = '女'"
            ))
            logger.info("[INTG][DB] Gender fix applied for pat_002/pat_003 (migration 026 fallback)")
    except Exception as e:
        logger.warning("[INTG][DB] Gender fix failed (non-fatal): %s", e)

    # Seed ICU drug interactions from DrugData (182 pairs)
    try:
        from app.database import engine as _eng3
        from sqlalchemy import text as _t3
        async with _eng3.begin() as conn:
            row = await conn.execute(_t3("SELECT COUNT(*) FROM drug_interactions"))
            count = row.scalar() or 0
            if count < 20:  # only seed if table has few records
                import json as _json3
                from pathlib import Path as _P3
                seed_path = _P3(__file__).resolve().parents[1] / "seeds" / "icu_drug_interactions.json"
                if seed_path.exists():
                    interactions = _json3.loads(seed_path.read_text("utf-8"))
                    for ix in interactions:
                        await conn.execute(_t3(
                            "INSERT INTO drug_interactions (drug1, drug2, severity, mechanism, clinical_effect, management, \"references\") "
                            "SELECT :d1, :d2, :sev, :mech, :ce, :mgmt, :ref "
                            "WHERE NOT EXISTS (SELECT 1 FROM drug_interactions WHERE LOWER(drug1)=LOWER(:d1) AND LOWER(drug2)=LOWER(:d2))"
                        ).bindparams(
                            d1=ix["drug1"], d2=ix["drug2"], sev=ix["severity"],
                            mech=ix.get("mechanism",""), ce=ix.get("clinical_effect",""),
                            mgmt=ix.get("management",""), ref=ix.get("references",""),
                        ))
                    logger.info("[INTG][DB] Seeded %d ICU drug interactions", len(interactions))
    except Exception as e:
        logger.warning("[INTG][DB] ICU drug interactions seed failed (non-fatal): %s", e)

    # Auto-index RAG documents: try persisted → check fingerprint → rebuild if needed
    if getattr(settings, "RAG_AUTO_INDEX_ON_STARTUP", True):
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
        except Exception as e:
            logger.warning("[INTG][RAG] Auto-indexing failed (non-fatal): %s", e)

    yield
    # Shutdown
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
app.include_router(ai_readiness.router)
app.include_router(rag.router)
app.include_router(rules.router)
app.include_router(ai_chat.router)

# Phase 4: V2 endpoints + Clinical Scores
app.include_router(patients_v2.router)
app.include_router(scores.router)
