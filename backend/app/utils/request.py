"""Shared HTTP request helpers.

This module centralizes extraction of the real client IP for audit logging.
"""

from typing import Optional

from starlette.requests import Request


def get_client_ip(request: Request) -> Optional[str]:
    """Return the originating client IP for ``request``.

    The app always sits behind a known reverse proxy (Vercel in front of
    Railway), so ``request.client.host`` is the *proxy's* IP rather than the
    real caller — which silently corrupts audit logs. Because the proxy chain
    is trusted and fixed, we trust the proxy-set forwarding headers and use
    this resolution order:

    1. First non-empty hop of the ``X-Forwarded-For`` header (the original
       client; later hops are intermediate proxies).
    2. ``X-Real-IP`` header.
    3. ``request.client.host`` (direct connection / no proxy headers).
    4. ``None`` when the client is unknown (e.g. ASGI test transports).
    """
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        for hop in forwarded_for.split(","):
            candidate = hop.strip()
            if candidate:
                return candidate

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        candidate = real_ip.strip()
        if candidate:
            return candidate

    if request.client:
        return request.client.host

    return None
