# Security Policy — ChatICU

## 1. Reporting Vulnerabilities

If you discover a security vulnerability, **do not open a public issue**.
Contact the maintainers privately via the channel defined in your organisation's
incident-response policy. Include:

- Description of the vulnerability
- Steps to reproduce
- Affected component (backend / frontend / infrastructure)
- Severity assessment (Critical / High / Medium / Low)

## 2. Secret & Key Management

### 2.1 Which secrets exist

| Secret | Location | Rotation cadence |
|--------|----------|-----------------|
| `JWT_SECRET` | `backend/.env` | Every 90 days or after any personnel change |
| `OPENAI_API_KEY` | `backend/.env` | Immediately after suspected exposure; otherwise quarterly |
| `ANTHROPIC_API_KEY` | `backend/.env` | Same as above |
| `DATABASE_URL` | `backend/.env` | On credential rotation schedule |
| `SEED_DEFAULT_PASSWORD` | `backend/.env` | Every deployment; one-time seed only |

### 2.2 `.env` management rules

1. **Never commit `.env` files.** Both `/.env` and `/backend/.env` are in `.gitignore`.
2. **Never log, print, or return secret values** in API responses, error messages,
   or CI output.
3. Use `.env.example` as the template. It contains `CHANGE_ME` placeholders only.
4. In CI/CD, inject secrets via GitHub Secrets / Vault / cloud secret manager —
   never as plaintext in workflow files.
5. Local `.env` files should have `chmod 600` permissions.

### 2.3 Key rotation procedure

```text
1. Generate new secret:
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"

2. Update backend/.env with the new value.

3. For API keys (OpenAI / Anthropic):
   a. Generate a new key in the provider dashboard.
   b. Update backend/.env.
   c. Revoke the old key in the provider dashboard.
   d. Verify the application works with the new key.

4. For JWT_SECRET rotation:
   a. Update backend/.env with the new secret.
   b. Restart the backend service.
   c. Note: All existing sessions will be invalidated (expected).

5. Record the rotation in your change-management log.
```

## 3. Incident Response — Minimum Steps

If a secret is suspected to be exposed:

```text
Step 1 — CONTAIN (< 15 min)
  - Revoke the exposed key/secret immediately via the provider dashboard.
  - If JWT_SECRET: rotate and restart; all sessions are invalidated.
  - If DB credentials: change password, restart backend.

Step 2 — ASSESS (< 1 hour)
  - Check git history for accidental commits:
      git log --all -p -S 'sk-' -- '*.py' '*.ts' '*.env*'
      git log --all -p -S 'OPENAI_API_KEY=' -- .
  - Check CI logs for leaked values.
  - Review API provider usage dashboards for unauthorized calls.

Step 3 — REMEDIATE
  - If found in git history, use BFG Repo-Cleaner or git-filter-repo:
      # Install: brew install bfg
      bfg --replace-text passwords.txt repo.git
      git reflog expire --expire=now --all && git gc --prune=now --aggressive
  - Force-push cleaned history (coordinate with team).
  - Rotate ALL secrets that may have been in the same commit.

Step 4 — DOCUMENT
  - Record: what was exposed, when, blast radius, remediation actions.
  - Update rotation schedule if needed.
  - Conduct post-incident review within 48 hours.
```

## 4. Repository Hygiene — Scanning Commands

Run these periodically or in CI to detect accidental secret commits:

```bash
# Scan current working tree for common secret patterns
grep -rInE '(sk-[a-zA-Z0-9]{20,}|OPENAI_API_KEY\s*=\s*['\''"][^C][^H])' \
  backend/ src/ --exclude-dir=node_modules --exclude-dir=.git

# Scan entire git history for secrets
git log --all -p -S 'sk-' -- '*.py' '*.env' '*.ts'

# Recommended: install detect-secrets for automated pre-commit scanning
pip install detect-secrets
detect-secrets scan backend/ src/ --exclude-files '\.lock$'
```

## 5. Startup Security Gates

The application enforces the following at startup (fail-closed):

| Check | Condition | Behaviour |
|-------|-----------|-----------|
| `JWT_SECRET` | Missing, empty, or < 32 chars in non-DEBUG mode | `sys.exit(1)` with error message to stderr |
| `SEED_DEFAULT_PASSWORD` | Missing when running seed script | `sys.exit(1)` |

## 6. CORS Policy

- Production: `CORS_ORIGINS` must be set via environment variable to the exact
  production domain(s). The default list contains only `localhost` / `127.0.0.1`
  entries for local development.
- `0.0.0.0` origins are explicitly prohibited and have been removed from defaults.
- Override via `.env`: `CORS_ORIGINS='["https://your-domain.com"]'`
