# T27 Release Gate Policy

## Scope
Defines which E2E checks are required for release, and which are supporting signals.

## Gate Rules (Current)
1. Required gate
   - `e2e-critical-journey` must pass on release branch / main merge flow.
2. Supporting gate (non-blocking)
   - `e2e-extended-journeys` runs on weekly schedule or manual dispatch (`run_extended_e2e=true`).
   - Used for regression signal and coverage expansion.

## Escalation Rule
- If `e2e-extended-journeys` fails in 2 consecutive runs, promote to temporary blocking gate until green for 3 consecutive runs.

## Evidence
- First green run with extended journeys: `22033478586`
- Workflow: `.github/workflows/ci.yml`
