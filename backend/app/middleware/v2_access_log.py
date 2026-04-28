"""PHI-safe access logger for /v2/patients (audit doc §4.1).

Goal: accumulate 1-2 weeks of observation data to confirm prod traffic
to the v2 router is zero before deleting it. The router's tests +
Vercel /v2/* rewrite + frontend src/lib/api/layer2-mode.ts together
mean we cannot delete v2 blindly; an explicit access log is the
cheapest way to catch a forgotten caller.

PHI handling — what is recorded vs what is NOT:
  RECORDED  HTTP method, route path TEMPLATE (e.g. /v2/patients/{patient_id}
            rather than the substituted URL), response status code,
            user id SHA256 hash truncated to 16 chars, user-agent prefix
            truncated to 80 chars, ISO timestamp.
  NEVER     Request body, response body, query string values, raw user
            id, raw URL with substituted patient_id / MRN / lab_id /
            medication_id, patient name, any header beyond user-agent.

Only authenticated requests are tagged with a user hash; unauthenticated
requests still log method/path/status with user_hash="anon" so we can
spot scraping or misconfigured external probes.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.middleware.auth import COOKIE_ACCESS_KEY
from app.utils.security import decode_token


_V2_PATH_PREFIX = "/v2/patients"
_LOGGER = logging.getLogger("chaticu.v2_access")
_USER_HASH_LEN = 16
_UA_PREFIX_LEN = 80


def _hash_user_id(user_id: str) -> str:
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:_USER_HASH_LEN]


def _extract_token(request: Request) -> Optional[str]:
    """Best-effort token extraction without raising. Mirrors auth
    middleware: ``Authorization: Bearer ...`` first, then the
    ``chaticu_access`` cookie (the canonical name used by the auth
    router and the get_current_user dependency). Never consults Redis
    or the DB — middleware must stay cheap.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip() or None
    cookie_token = request.cookies.get(COOKIE_ACCESS_KEY)
    return cookie_token or None


def _user_hash_from_request(request: Request) -> str:
    """Return SHA256 hash of the JWT subject, or 'anon' if unauth/invalid.

    Decodes the JWT locally (no Redis, no DB lookup) so the middleware
    does not add a per-request round-trip. A blacklisted-but-decodable
    token will still produce a hash here — that is acceptable: the
    request is rejected by the real auth dependency, and the access log
    only counts intent, not authorisation outcome.
    """
    token = _extract_token(request)
    if not token:
        return "anon"
    payload = decode_token(token)
    if not payload:
        return "anon"
    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        return "anon"
    return _hash_user_id(user_id)


def _route_template(request: Request, response: Response) -> str:
    """Return the matched route's path template (e.g.
    ``/v2/patients/{patient_id}``) so dynamic path values never enter
    logs. Falls back to the static prefix when no route matched
    (404 / 405).
    """
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    if isinstance(template, str) and template:
        return template
    # Don't fall back to request.url.path — it contains substituted
    # patient_id / lab_id / medication_id values which are PHI.
    return f"{_V2_PATH_PREFIX}/<unmatched>"


class V2AccessLogMiddleware(BaseHTTPMiddleware):
    """Emit one structured INFO line per /v2/patients request.

    Non-/v2/patients paths pass through with no logging overhead beyond
    the path prefix check (one string comparison per request).
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[override]
        if not request.url.path.startswith(_V2_PATH_PREFIX):
            return await call_next(request)

        method = request.method
        ua = (request.headers.get("user-agent") or "")[:_UA_PREFIX_LEN]
        user_hash = _user_hash_from_request(request)

        response = await call_next(request)

        try:
            _LOGGER.info(
                "[V2_ACCESS] ts=%s method=%s route=%s status=%d user_hash=%s ua=%s",
                datetime.now(timezone.utc).isoformat(),
                method,
                _route_template(request, response),
                response.status_code,
                user_hash,
                ua,
            )
        except Exception:
            # Never let logging break a real response.
            pass
        return response
