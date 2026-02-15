from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "ChatICU API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Database
    # DATABASE_URL MUST be set via .env; default is a non-functional placeholder
    DATABASE_URL: str = "postgresql+asyncpg://user:pass@localhost:5432/chaticu"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT — JWT_SECRET MUST be overridden via .env; default is dev-only
    JWT_SECRET: str = "INSECURE-DEV-ONLY-OVERRIDE-IN-PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 min (production-safe default)
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 1  # 1 day
    SESSION_IDLE_TIMEOUT_MINUTES: int = 30  # auto-logout after 30 min inactivity

    # Password Policy (T07)
    PASSWORD_EXPIRY_DAYS: int = 90       # force change after 90 days
    PASSWORD_HISTORY_COUNT: int = 5      # disallow reuse of last 5 passwords

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
    ]

    # Rate Limiting
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_DEFAULT: str = "60/minute"

    # LLM (Phase 3)
    LLM_PROVIDER: str = "openai"
    LLM_MODEL: str = "gpt-4o"
    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 2048
    OPENAI_API_KEY: str = ""
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    ANTHROPIC_API_KEY: str = ""

    # RAG (Phase 3)
    RAG_DOCS_PATH: str = ""

    # Alerting (T28) — Webhook URL for severe error notifications (Slack/PagerDuty/email)
    ALERT_WEBHOOK_URL: str = ""

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


settings = Settings()
