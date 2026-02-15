# Release Approval Checklist (T21)

## Pre-release
- [ ] CR approved by Tech Lead / QA / Security / Release Manager
- [ ] `CHANGELOG.md` updated
- [ ] Version number confirmed (`APP_VERSION` / tag plan)
- [ ] DB migration reviewed and reversible
- [ ] Rollback SOP confirmed by on-duty engineer

## CI Gate
- [ ] Latest CI run is fully green
- [ ] Backend tests passed
- [ ] Frontend build passed
- [ ] Migration-check passed
- [ ] E2E critical journey passed
- [ ] SAST passed
- [ ] DAST passed (no High findings)
- [ ] Docker build/run checks passed

## Release Decision
- [ ] Go / No-Go decision recorded
- [ ] Release window approved
- [ ] On-call contact assigned

## Post-release
- [ ] Smoke tests completed
- [ ] Monitoring/logs normal for first 30 minutes
- [ ] Release note published
