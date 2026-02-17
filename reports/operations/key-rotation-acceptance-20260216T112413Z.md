# Key Rotation Acceptance Report

- Generated at (UTC): 20260216T112413Z
- Automation status: PASS
- Workspace: `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu`

## 1) Manual Rotation Checklist (Owner Sign-off Required)

- [ ] OpenAI provider key rotated (new key ID masked): `________`
- [ ] Previous OpenAI key revoked (timestamp UTC): `________`
- [ ] `JWT_SECRET` rotated in runtime env (not committed): `YES/NO`
- [ ] DB/Redis credentials rotated if applicable: `YES/NO/N/A`
- [ ] Change ticket / incident ID linked: `________`
- [ ] Sign-off owner: `________`
- [ ] Sign-off date (UTC): `________`

## 2) Automated Verification

| Check | Command | Result | Key Output (tail) | Log |
|---|---|---|---|---|
| Tracked-files secret pattern scan | `cd '/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu' && if rg -n -I --no-messages '(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z\-_]{35}|sk-[A-Za-z0-9]{20,})' $(git ls-files); then echo '[INTG][OPS] secret pattern detected'; exit 1; else echo '[INTG][OPS] no secret pattern in tracked files'; fi` | PASS | [INTG][OPS] no secret pattern in tracked files | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/key-rotation-acceptance-20260216T112413Z.logs/secret_scan.log` |
| Datamock schema validation | `cd '/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend' && ./.venv312/bin/python -m seeds.validate_datamock` | PASS | Datamock validation passed: {'users': 4, 'patients': 4, 'medications': 11, 'labData': 4, 'patientMessages': 10, 'teamChatMessages': 5, 'drugInteractions': 4, 'ivCompatibility': 4} | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/key-rotation-acceptance-20260216T112413Z.logs/datamock_validate.log` |
| Backend contract tests | `cd '/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend' && ./.venv312/bin/pytest tests/test_api/test_contract.py -q` | PASS | ..................... [100%] =============================== warnings summary =============================== .venv312/lib/python3.12/site-packages/passlib/utils/__init__.py:854 /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/.venv312/lib/python3.12/site-packages/passlib/utils/__init__.py:854: DeprecationWarning: 'crypt' is deprecated and slated for removal in Python 3.13 from crypt import crypt as _crypt -- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html 21 passed, 1 warning in 16.84s | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/key-rotation-acceptance-20260216T112413Z.logs/contract_tests.log` |
| Backend integration tests | `cd '/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend' && ./.venv312/bin/pytest tests/test_api -q` | PASS | tests/test_api/test_auth_flows.py::test_logout_revokes_access_and_refresh_tokens tests/test_api/test_auth_flows.py::test_role_based_access_denies_non_admin_user tests/test_api/test_auth_flows.py::test_session_idle_timeout_expires_inactive_session /Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/backend/.venv312/lib/python3.12/site-packages/jose/jwt.py:311: DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version. Use timezone-aware objects to represent datetimes in UTC: datetime.datetime.now(datetime.UTC). now = timegm(datetime.utcnow().utctimetuple()) -- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html 79 passed, 5 warnings in 68.44s (0:01:08) | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/key-rotation-acceptance-20260216T112413Z.logs/backend_integration.log` |
| Frontend typecheck | `cd '/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu' && npm run typecheck` | PASS | > ChatICU_2026_verf_0110_Yu@0.1.0 typecheck > tsc -p tsconfig.json | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/key-rotation-acceptance-20260216T112413Z.logs/frontend_typecheck.log` |
| E2E critical smoke | `cd '/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu' && npm run test:e2e -- --project=chromium --grep '@critical'` | PASS | ✓ 1 [chromium] › e2e/critical-journey.spec.js:10:3 › T27 Critical Journey › critical flow @critical: login -> patients -> detail -> ai chat -> logout (10.9s) 1 passed (12.0s) To open last HTML report run: [36m[39m [36m npx playwright show-report output/playwright/html-report[39m [36m[39m | `/Users/chun/Desktop/ChatICU_2026_verf_0110_Yu/reports/operations/key-rotation-acceptance-20260216T112413Z.logs/e2e_critical.log` |

## 3) Gate

- If all manual checkboxes above are checked and automation status is PASS: **READY_TO_CLOSE**
- Otherwise: **NOT_READY**
