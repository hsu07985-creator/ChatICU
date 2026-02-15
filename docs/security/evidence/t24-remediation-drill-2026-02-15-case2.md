# T24 Remediation Drill — Case 2 (2026-02-15)

## Finding
- Finding ID: `VULN-20260215-002`
- Source: DAST baseline policy review
- Severity: Medium
- Affected asset: API response headers / transport policy checks

## Timeline
- Open date: 2026-02-15
- SLA due date (Medium, 30d): 2026-03-17
- Closed date: 2026-02-15

## Fix
- Confirmed pipeline-level gate and summary output in CI:
  - Added DAST gate summary artifact generation (`output/dast/dast-gate-summary.md`)
  - Maintained blocking policy: High > 0 fails pipeline
- Reference: `.github/workflows/ci.yml`

## Retest Evidence
- CI run id: `22031771983`
- Evidence:
  - `dast-zap-report` artifact
  - Security gate passed

## Reviewer
- Security Eng (simulation)

## Result
- Status: Closed
- Notes: Process evidence chain completed (detect -> mitigate -> retest -> close).
