# T23 Security Scan Summary (2026-02-15)

## Scope
- SAST: Bandit (`security-scan` job)
- DAST: OWASP ZAP baseline (`dast-scan` job)
- Gate policy: block deployment when High-risk findings > 0

## Evidence Runs
1. Run `22031345836`
   - SAST: pass
   - DAST: pass
   - Artifact: `dast-zap-report`
2. Run `22031771983`
   - SAST: pass
   - DAST: pass
   - Gate: pass (`High == 0`)
3. Run `22033478586` (workflow_dispatch)
   - SAST: pass
   - DAST: pass
   - Gate: pass (`High == 0`)
   - Artifacts downloaded and validated locally:
     - `dast-gate-summary.md`
     - `zap-warnings.md`
     - `zap-report.json` / `zap-report.html`

## Gate Decision
- Current gate status: PASS
- Blocking rule verified: enabled in `.github/workflows/ci.yml` (`Enforce DAST gate (block on High)`)

## DAST Artifact Metrics (Run `22033478586`)
- Total alerts: `4`
- High: `0`
- Medium: `0`
- Low: `1`
- Informational: `1` (3 instances for cacheable content)
- Gate summary: `PASS (policy: High > 0 blocks)`

## Notes
- Current baseline remains releasable under gate policy.
- Low/Informational findings are tracked under T24 remediation register for hardening follow-up.
- Code-level mitigation added in Session 12:
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Cache-Control: no-store`, `Pragma: no-cache`, `Expires: 0`
  - Verified by contract test updates in `backend/tests/test_api/test_contract.py`

## Residual Risk
- Low/Informational findings still require hardening triage and SLA tracking under T24.
