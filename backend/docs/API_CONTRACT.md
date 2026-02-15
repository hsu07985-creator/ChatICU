# ChatICU API Contract — v1.0

**Status:** FROZEN (v1)
**Date:** 2026-02-15
**Applies to:** `backend/` (production backend)

> Changes to this contract require version bump and frontend sign-off.

---

## 1. Base URL

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:8000` |
| Docker | `http://api:8000` (internal) |
| Production | `https://<domain>/api` (via reverse proxy) |

API Documentation: `GET /docs` (Swagger UI) | `GET /redoc` (ReDoc)

---

## 2. Response Envelope

ALL endpoints return the same JSON envelope:

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "message": "optional message"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | `boolean` | Yes | Always `true` |
| `data` | `object \| array \| null` | No | Response payload |
| `message` | `string \| null` | No | Human-readable message |

### Error Response

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable error description"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `success` | `boolean` | Yes | Always `false` |
| `error` | `string` | Yes | Machine-readable error code (see Section 3) |
| `message` | `string` | Yes | Human-readable error message |
| `details` | `array` | Only for 422 | Validation error details |

### Validation Error (422) — Extended

```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "body → egfr: Field required",
  "details": [
    { "field": "body → egfr", "message": "Field required" },
    { "field": "body → name", "message": "String should have at least 1 character" }
  ]
}
```

---

## 3. Error Codes

### HTTP Status → Error Code Mapping

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | `BAD_REQUEST` | Invalid request parameters |
| 401 | `UNAUTHORIZED` | Missing, expired, or revoked token |
| 403 | `FORBIDDEN` | Insufficient role/permissions |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate resource (e.g., username exists) |
| 422 | `VALIDATION_ERROR` | Request body validation failed |
| 429 | `RATE_LIMIT_EXCEEDED` | Too many requests |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Service dependency unavailable (e.g., RAG not indexed) |

### Rules

1. Error `message` may be in Chinese (zh-TW) for user-facing messages
2. Error `error` code is always uppercase English with underscores
3. In production (`DEBUG=false`), 500 errors hide internal details
4. In development (`DEBUG=true`), 500 errors include exception message

---

## 4. Authentication

### Token Flow

```
1. POST /auth/login                  → { user, token, refreshToken, expiresIn, passwordExpired }
2. Use token as:                      Authorization: Bearer <token>
3. POST /auth/refresh                → { token, refreshToken, expiresIn }  (rotation: old refresh blacklisted)
4. POST /auth/logout                 → access token + refresh token blacklisted in Redis
5. POST /auth/change-password        → self-service password change (T07)
6. POST /auth/reset-password-request → one-time reset token via email (T08, rate-limited 3/min)
7. POST /auth/reset-password         → consume reset token, set new password (T08)
8. GET  /auth/me                     → current user profile + permissions
```

### Endpoint Details — Authentication

#### `POST /auth/login`
**Rate limit:** 5/minute per IP. Account locked after 5 consecutive failures (15 min lockout).

Request:
```json
{ "username": "doctor1", "password": "..." }
```
Response:
```json
{
  "success": true,
  "data": {
    "user": { "id": "usr_001", "name": "王醫師", "role": "doctor", "unit": "加護病房一", "email": "..." },
    "token": "<access_jwt>",
    "refreshToken": "<refresh_jwt>",
    "expiresIn": 900,
    "passwordExpired": false
  }
}
```

#### `POST /auth/refresh`
Rotation: returns new access + refresh token; old refresh token is blacklisted.

Request:
```json
{ "refreshToken": "<old_refresh_jwt>" }
```
Response:
```json
{
  "success": true,
  "data": { "token": "<new_access>", "refreshToken": "<new_refresh>", "expiresIn": 900 }
}
```

#### `POST /auth/logout`
Request body (optional):
```json
{ "refreshToken": "<refresh_jwt>" }
```
Both access token (from Authorization header) and refresh token (if provided) are blacklisted.

#### `POST /auth/change-password`
**Auth required.** Validates current password, new password strength (>=12 chars, upper+lower+digit+special), and 5-cycle history.

Request:
```json
{ "currentPassword": "...", "newPassword": "..." }
```

#### `POST /auth/reset-password-request`
**Rate limit:** 3/minute. Returns identical message regardless of username existence (anti-enumeration).

Request:
```json
{ "username": "doctor1" }
```
Response:
```json
{ "success": true, "message": "若帳號存在，重設連結已發送至信箱" }
```

#### `POST /auth/reset-password`
Consumes one-time token (30min TTL). Validates password strength + history.

Request:
```json
{ "token": "<reset_token>", "newPassword": "..." }
```

#### `GET /auth/me`
**Auth required.** Returns current user profile and role-based permissions.

### JWT Payload

```json
{
  "sub": "usr_001",
  "username": "doctor1",
  "role": "doctor",
  "type": "access",
  "exp": 1739700000,
  "iat": 1739613600,
  "jti": "unique-token-id"
}
```

| Field | Description |
|-------|-------------|
| `sub` | User ID |
| `username` | Login username |
| `role` | One of: `nurse`, `doctor`, `pharmacist`, `admin` |
| `type` | `access` or `refresh` |
| `exp` | Expiration timestamp (Unix) |
| `iat` | Issued-at timestamp (Unix) |
| `jti` | Unique token identifier (for blacklisting) |

### Token Lifetimes

| Token | Default | Notes |
|-------|---------|-------|
| Access | 15 min | Production-safe default |
| Refresh | 1 day | Rotation on each refresh |
| Idle timeout | 30 min | Redis `last_activity` tracking |

### Password Policy (T07)

| Rule | Value |
|------|-------|
| Minimum length | 12 characters |
| Complexity | upper + lower + digit + special |
| Expiry | 90 days (login returns `passwordExpired: true`) |
| History | Last 5 passwords cannot be reused |

### Account Lockout (T08)

| Rule | Value |
|------|-------|
| Max failed attempts | 5 |
| Lockout duration | 15 minutes |
| Reset token TTL | 30 minutes (one-time use) |

---

## 5. Pagination Convention

Endpoints that return lists use query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | `int` | 1 | Page number (1-based) |
| `limit` | `int` | 20 | Items per page (max 100) |
| `search` | `string` | — | Search filter (endpoint-specific) |

Response includes pagination metadata in `data`:

```json
{
  "success": true,
  "data": {
    "items": [ ... ],
    "total": 150,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```

---

## 6. Endpoint Groups & Versioning

| Prefix | Version | Description |
|--------|---------|-------------|
| `/` | — | Root + health check (public) |
| `/auth/*` | — | Authentication (login/logout/refresh/change-password/reset-password) |
| `/patients/*` | — | Patient CRUD + nested resources |
| `/team/chat/*` | — | Team collaboration messaging |
| `/dashboard/*` | — | Dashboard statistics |
| `/admin/*` | — | Admin panel (admin-only) |
| `/pharmacy/*` | — | Pharmacy error reports |
| `/api/v1/clinical/*` | v1 | Clinical AI endpoints (LLM) |
| `/api/v1/rag/*` | v1 | RAG document search |
| `/api/v1/rules/*` | v1 | Clinical rule engine |
| `/ai/*` | — | AI chat sessions (DB-persisted) |

### Versioning Policy

- Current API version: **v1**
- AI/clinical endpoints are explicitly versioned (`/api/v1/`)
- Breaking changes require version bump (`/api/v2/`)
- Non-breaking additions (new optional fields) allowed within v1

---

## 7. CORS Policy

```json
{
  "allow_origins": ["http://localhost:3000", "http://localhost:5173", "http://localhost:8080"],
  "allow_credentials": true,
  "allow_methods": ["*"],
  "allow_headers": ["*"]
}
```

Production: restrict `allow_origins` to actual domain.

---

## 8. Rate Limiting

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `POST /auth/login` | 5/minute | Per IP |
| `POST /auth/reset-password-request` | 3/minute | Per IP |
| All other endpoints | 60/minute | Per IP |

Rate limit exceeded returns:

```json
{
  "success": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Rate limit exceeded"
}
```

---

## 9. Content Type

| Direction | Content-Type |
|-----------|-------------|
| Request | `application/json` |
| Response | `application/json` |

All timestamps in responses are ISO 8601 format in UTC:
```
"2026-02-15T08:30:00+00:00"
```

---

## 10. Contract Validation

Automated tests verify:
- All success responses contain `{"success": true}`
- All error responses contain `{"success": false, "error": "...", "message": "..."}`
- All 404s return the standard error envelope
- All 422s return with `details` array
- `/health` and `/` follow the envelope format

Test file: `tests/test_api/test_contract.py`
