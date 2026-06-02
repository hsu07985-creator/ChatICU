from starlette.requests import Request
from slowapi import Limiter

from app.utils.request import get_client_ip


def _get_client_ip(request: Request) -> str:
    """Extract client IP; fall back to '127.0.0.1' for ASGI test transports."""
    return get_client_ip(request) or "127.0.0.1"


limiter = Limiter(key_func=_get_client_ip)
