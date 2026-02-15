# T27 Branch Protection Apply Checklist

## Scope
- Repository: `jht12020304/ChatICU`
- Branch: `main`
- Objective:
  - Make `e2e-critical-journey` a required release gate.
  - Keep `e2e-extended-journeys` as non-blocking supporting check.

## Required Status Checks (must pass before merge)
1. `backend-test`
2. `backend-lint`
3. `migration-check`
4. `security-scan`
5. `frontend-build`
6. `e2e-critical-journey`
7. `dast-scan`
8. `reproducibility-report`
9. `docker-build`

## Optional/Supporting Checks
1. `e2e-extended-journeys` (schedule/workflow_dispatch)

## Apply Steps (GitHub UI)
1. Open repo settings -> `Branches` -> `Branch protection rules`.
2. Edit/create rule for `main`.
3. Enable `Require a pull request before merging`.
4. Enable `Require status checks to pass before merging`.
5. Add the 9 required checks listed above.
6. Do not add `e2e-extended-journeys` as required (kept supporting).
7. Save rule and capture screenshot evidence.

## Verification
1. Open a test PR and confirm merge is blocked when `e2e-critical-journey` fails.
2. Confirm merge is not blocked when only `e2e-extended-journeys` is skipped/failed.
3. Record evidence:
   - branch protection screenshot
   - one blocked PR screenshot
   - one successful PR screenshot

## Evidence Location
- `docs/qa/evidence/t27-branch-protection-main.png`
- `docs/qa/evidence/t27-blocked-pr-critical-fail.png`
- `docs/qa/evidence/t27-pass-pr-critical-green.png`
