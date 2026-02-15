# Rollback Drill Record

- Drill ID: `RB-2026-02-15-001`
- Date: 2026-02-15
- Target change set:
  - `2e23786` (header hardening)
  - `a768e7c` (upload guard test)

## Drill Procedure (Dry-run)
1. Identify latest stable commit before target set.
2. Prepare rollback command set:
   - `git revert --no-edit a768e7c`
   - `git revert --no-edit 2e23786`
3. Validate rollback branch pipeline.
4. Validate forward-fix reapply path.

## Validation Criteria
- CI must remain green after rollback.
- DAST gate must still pass (High=0).
- No regression on contract tests.

## Outcome
- Exercise type: tabletop + command-plan simulation (no production impact)
- Result: Pass
- Evidence references:
  - `docs/release/rollback-sop.md`
  - `docs/release/records/cr-2026-02-15-session13.md`
  - CI baseline run `22033663309`

## Follow-up
- Schedule one live non-production rollback rehearsal in staging during next release window.
