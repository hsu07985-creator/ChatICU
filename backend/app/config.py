from pathlib import Path
from pydantic_settings import BaseSettings
from typing import List, Literal


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "ChatICU API"
    APP_VERSION: str = "1.4.1"
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
    OPENAI_API_KEY: str = ""
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-large"
    ANTHROPIC_API_KEY: str = ""

    # Embedding Cache (Redis)
    EMBEDDING_CACHE_ENABLED: bool = True
    EMBEDDING_CACHE_TTL_SECONDS: int = 604800  # 7 days

    # Reranker — "cohere" (fast, dedicated) or "llm" (GPT-based fallback)
    RERANKER_PROVIDER: str = "cohere"
    COHERE_API_KEY: str = ""
    COHERE_RERANK_MODEL: str = "rerank-v3.5"

    # Agentic RAG — LLM decides search strategy (multi-round retrieval)
    RAG_AGENTIC_ENABLED: bool = False
    RAG_AGENTIC_MAX_ROUNDS: int = 3
    RAG_AGENTIC_MODEL: str = "gpt-5-mini"

    # LLM-based Guardrail — augments regex guardrail with LLM safety check
    GUARDRAIL_LLM_ENABLED: bool = True

    # RAG (Phase 3)
    RAG_DOCS_PATH: str = ""
    RAG_MIN_CITATIONS: int = 1
    RAG_MIN_CONFIDENCE: float = 0.55

    # RAG Reranker — LLM-based cross-encoder reranking for improved retrieval
    RAG_RERANK_ENABLED: bool = True
    RAG_RERANK_MODEL: str = "gpt-5-mini"
    RAG_RERANK_CANDIDATES: int = 20  # over-retrieve count before reranking

    # RAG Hybrid Search — combine vector similarity with BM25 keyword matching
    RAG_HYBRID_ENABLED: bool = True
    RAG_BM25_WEIGHT: float = 0.3  # BM25 weight (vector weight = 1 - this)

    # RAG Citation Summary — LLM refines raw chunks into structured citations
    RAG_CITATION_SUMMARY_ENABLED: bool = False  # disabled — no RAG index active

    # RAG Index Persistence — persist embeddings + BM25 to disk
    RAG_INDEX_DIR: str = ""  # default: backend/data/rag_index/
    RAG_AUTO_INDEX_ON_STARTUP: bool = True

    # RAG Contextual Retrieval — prepend LLM-generated context to each chunk
    # before embedding (Anthropic technique, ~67% fewer retrieval failures)
    RAG_CONTEXTUAL_RETRIEVAL_ENABLED: bool = True
    RAG_CONTEXTUAL_MODEL: str = "gpt-5.4-mini"
    RAG_CONTEXTUAL_MAX_DOC_CHARS: int = 8000  # truncate long docs for context prompt
    RAG_CONTEXTUAL_WORKERS: int = 8  # parallel LLM calls for context generation

    # Drug Interaction Graph (local DrugData)
    DRUG_GRAPH_ENABLED: bool = True
    DRUG_GRAPH_SCRIPT_PATH: str = str(
        Path(__file__).resolve().parents[2] / "data" / "drug_interactions" / "DrugData" / "drug_graph_rag.py"
    )
    DRUG_GRAPH_DATA_ROOT: str = str(
        Path(__file__).resolve().parents[2] / "data" / "drug_interactions" / "DrugData"
    )

    # Layer2 structured data store (JSONL files)
    LAYER2_ROOT: str = ""

    # Evidence RAG microservice (func/) — hybrid RAG, dose calc, interactions
    # Override FUNC_API_URL in containers (e.g. FUNC_API_URL=http://func:8001)
    FUNC_API_URL: str = "http://127.0.0.1:8001"
    FUNC_API_TIMEOUT: float = 30.0  # HTTP timeout in seconds for evidence service (F12)
    FUNC_API_RETRY_COUNT: int = 2
    FUNC_API_RETRY_BACKOFF_SECONDS: float = 0.5

    # Drug RAG microservices (Source A = guideline, Source B = drug-specific)
    SOURCE_A_URL: str = "http://127.0.0.1:8003"
    SOURCE_B_URL: str = "http://127.0.0.1:8004"
    SOURCE_PRIORITIES_PATH: str = "config/source_priorities.json"

    # Orchestrator (B07) — unified query endpoint
    ORCHESTRATOR_ENABLED: bool = False

    # NHI reimbursement RAG microservice
    NHI_SERVICE_URL: str = "http://127.0.0.1:8002"

    # Alerting (T28) — Webhook URL for severe error notifications (Slack/PagerDuty/email)
    ALERT_WEBHOOK_URL: str = ""

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
