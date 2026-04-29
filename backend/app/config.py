from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List, Literal


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "ChatICU API"
    APP_VERSION: str = "1.4.5"
    DEBUG: bool = False

    # Server
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # Database
    # DATABASE_URL MUST be set via .env; default is a non-functional placeholder
    DATABASE_URL: str = "postgresql+asyncpg://user:pass@localhost:5432/chaticu"
    # Data source mode:
    # - db:   normal mode (PostgreSQL/Redis-backed API)
    # - json: offline development mode (DB is seeded from datamock JSON)
    DATA_SOURCE_MODE: Literal["db", "json"] = "db"
    # Optional override for datamock path (used in json mode tools/seeds)
    DATAMOCK_DIR: str = ""

    # Redis — use rediss:// for TLS connections
    REDIS_URL: str = "redis://localhost:6379/0"
    # SSL cert verification: "required" | "optional" | "none" (for self-signed certs)
    REDIS_SSL_CERT_REQS: str = "required"

    # Auth cookies (httpOnly JWT transport)
    COOKIE_SECURE: bool = True   # auto-overridden to False when DEBUG=True
    COOKIE_SAMESITE: str = "none"

    # JWT — JWT_SECRET MUST be set via .env; no usable default.
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 min (production-safe default)
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 1  # 1 day
    SESSION_IDLE_TIMEOUT_MINUTES: int = 30  # auto-logout after 30 min inactivity

    # Password Policy (T07)
    PASSWORD_EXPIRY_DAYS: int = 90       # force change after 90 days
    PASSWORD_HISTORY_COUNT: int = 5      # disallow reuse of last 5 passwords
    MIN_PASSWORD_LENGTH: int = 12        # minimum password length (F15)
    RESET_TOKEN_EXPIRE_MINUTES: int = 30  # password reset token TTL (F16)

    # CORS
    CORS_ORIGINS: List[str] = [
        "https://chat-icu.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:4173",
        "http://localhost:4174",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:4174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:8080",
    ]

    # Account Lockout (F10)
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_SECONDS: int = 900  # 15 minutes

    # Rate Limiting
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_DEFAULT: str = "60/minute"

    # LLM (Phase 3)
    LLM_PROVIDER: str = "openai"
    LLM_MODEL: str = "gpt-5.4-mini"
    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 4096
    LLM_REASONING_EFFORT: str = "low"  # none|low|medium|high (gpt-5.4-mini)
    LLM_RECENT_MSG_WINDOW: int = 10   # keep N most recent messages verbatim (F08)
    LLM_COMPRESS_THRESHOLD: int = 20  # trigger compression above this count (F08)
    # Optional audit capture of provider raw payloads (disabled by default).
    LLM_AUDIT_CAPTURE_RAW: bool = False
    LLM_AUDIT_CAPTURE_DIR: str = "reports/operations/llm_raw_capture"
    # B15-A1: split build_clinical_snapshot into critical (returned synchronously
    # to LLM on first turn) and deferred (vent/reports/scores, fetched in
    # background after the first response and merged into subsequent turns).
    # Off by default; flip to true in Railway env to canary the optimization.
    # See docs/b15-snapshot-latency-plan-2026-04-30.md.
    SNAPSHOT_DEFERRED_ENABLED: bool = False
    OPENAI_API_KEY: str = ""
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-large"
    ANTHROPIC_API_KEY: str = ""

    # RAG-related settings removed in Phase 1 D5 — see commit history.
    # The RAG layer (evidence_client / rag_service / orchestrator / source
    # registry / reranker / contextual retrieval / agentic RAG / Cohere /
    # FUNC_API microservice / SOURCE_A_URL / SOURCE_B_URL / NHI_SERVICE_URL /
    # PAD_API_URL / EMBEDDING_CACHE_* / GUARDRAIL_LLM_ENABLED / etc.) is
    # gone. Settings that survived the cleanup are below.

    # Drug Interaction Graph (local DrugData) — non-RAG, kept.
    DRUG_GRAPH_ENABLED: bool = True
    DRUG_GRAPH_SCRIPT_PATH: str = str(
        Path(__file__).resolve().parents[2] / "data" / "drug_interactions" / "DrugData" / "drug_graph_rag.py"
    )
    DRUG_GRAPH_DATA_ROOT: str = str(
        Path(__file__).resolve().parents[2] / "data" / "drug_interactions" / "DrugData"
    )

    # Layer2 structured data store (JSONL files) — non-RAG, kept.
    LAYER2_ROOT: str = ""

    # Alerting (T28) — Webhook URL for severe error notifications (Slack/PagerDuty/email)
    ALERT_WEBHOOK_URL: str = ""

    # HIS manual-sync admin endpoint (POST /admin/his-sync)
    # When empty, the endpoint is DISABLED (503). Set to a long random token
    # in backend/.env only on the Mac that owns the patient/ folder.
    # Generate with: python3 -c "import secrets; print(secrets.token_urlsafe(32))"
    ADMIN_SYNC_TOKEN: str = ""

    model_config = {
        # Load backend/.env regardless of the current working directory.
        "env_file": str(Path(__file__).resolve().parents[1] / ".env"),
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()

# ── Fail-closed: JWT_SECRET validation ──────────────────────────────────
# In non-DEBUG mode the application MUST NOT start without a proper secret.
_INSECURE_SECRETS = frozenset({
    "",
    "INSECURE-DEV-ONLY-OVERRIDE-IN-PRODUCTION",
    "CHANGE_ME",
    "secret",
    "jwt-secret",
})

if not settings.DEBUG and (settings.JWT_SECRET.strip() in _INSECURE_SECRETS
                           or len(settings.JWT_SECRET.strip()) < 32):
    import sys
    print(
        "FATAL: JWT_SECRET is missing or insecure. "
        "Set a cryptographically random value (>= 32 chars) in backend/.env. "
        "Generate one with: python3 -c \"import secrets; print(secrets.token_urlsafe(48))\"",
        file=sys.stderr,
    )
    sys.exit(1)
