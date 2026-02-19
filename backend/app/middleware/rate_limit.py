from starlette.requests import Request
from slowapi import Limiter


def _get_client_ip(request: Request) -> str:
    """Extract client IP; fall back to '127.0.0.1' for ASGI test transports."""
    if request.client:
        return request.client.host
    return "127.0.0.1"


limiter = Limiter(key_func=_get_client_ip)
