# Reproducibility Report Template (T22)

## Run Metadata
- Date:
- CI Run ID:
- Commit SHA:
- Branch:

## Environment Versions
- Python:
- Node.js:
- npm:
- Docker:

## Dependency Locks
- `backend/requirements.lock` SHA256:
- `package-lock.json` SHA256:

## Verification Matrix
| Check | Result | Evidence |
|---|---|---|
| Backend tests | Pass/Fail | workflow job + artifact |
| Backend lint | Pass/Fail | workflow job |
| Security scan (SAST) | Pass/Fail | Bandit artifact |
| Migration check | Pass/Fail | workflow job |
| Frontend build | Pass/Fail | workflow job |
| E2E critical journey | Pass/Fail | Playwright report/video |
| DAST scan | Pass/Fail | ZAP report |
| Docker build/run | Pass/Fail | workflow job |

## Conclusion
- Reproducible on clean CI environment: Yes/No
- Gaps/risks:
