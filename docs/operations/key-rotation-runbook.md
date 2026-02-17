# Key Rotation Runbook (Operational Closure)

## 1. Purpose
Provide an executable checklist to rotate potentially exposed credentials without leaking values in logs.

## 2. Rotation Scope
- `OPENAI_API_KEY` (provider console)
- `JWT_SECRET` (backend runtime signing key)
- `DATABASE_URL` password component (PostgreSQL user password)
- `REDIS_URL` password component (if enabled)

## 3. Preconditions
- Have owner access to provider/admin console.
- Schedule a maintenance window if active sessions can be invalidated.
- Prepare rollback: keep previous key in secure vault until verification completes.

## 4. Procedure

### Step A — Baseline checks
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
rg -n -I --no-messages '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z\-_]{35}|sk-[A-Za-z0-9]{20,})' $(git ls-files) || true
```
Expected: no matches in tracked files.

### Step B — Rotate provider key(s)
- Create new API key in provider console.
- Update secret store / deployment env.
- Revoke old key after cutover verification.

### Step C — Rotate local JWT secret (no secret printed)
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
python3 - <<'PY'
from pathlib import Path
import re, secrets
p = Path('backend/.env')
text = p.read_text(encoding='utf-8')
new = secrets.token_urlsafe(48)
text2, n = re.subn(r'^JWT_SECRET=.*$', f'JWT_SECRET={new}', text, flags=re.M)
if n != 1:
    raise SystemExit('JWT_SECRET key not found exactly once in backend/.env')
p.write_text(text2, encoding='utf-8')
print('JWT_SECRET rotated in backend/.env (value hidden)')
PY
```

### Step D — Restart and verify
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend
./.venv312/bin/python -m seeds.validate_datamock
./.venv312/bin/pytest tests/test_api/test_contract.py -q
```

Frontend/backend smoke:
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
npm run typecheck
npm run test:e2e -- --project=chromium --grep "@critical"
```

## 5. Evidence to Attach
- Timestamp of rotation window
- Key IDs (masked) from provider console
- Verification command outputs (PASS/FAIL)
- Rollback note (whether old key revoked)

## 6. Rollback
- Restore previous key from vault
- Restart services
- Re-run contract + smoke verification

## 7. Completion Criteria
- New key active in runtime
- Old key revoked
- Contract/E2E smoke passes
- No secret patterns found in tracked files

## 8. One-command Acceptance Report

Run:
```bash
cd /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu
bash ./scripts/ops/run_key_rotation_acceptance.sh
```

Output:
- Markdown report: `reports/operations/key-rotation-acceptance-<UTC>.md`
- Command logs: `reports/operations/key-rotation-acceptance-<UTC>.logs/`
