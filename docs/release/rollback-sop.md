# Rollback SOP (T21)

## Trigger Conditions
- Production outage or severe regression after release
- Security gate bypass detected post-deploy
- Data migration causes functional breakage

## Inputs
- Last known good image tag
- Current release commit SHA
- DB migration version (current/target)
- Service health endpoints

## Rollback Steps
1. Announce rollback in release channel and freeze new deploys.
2. Scale down or stop current release workload.
3. Deploy last known good image/tag.
4. If schema changed, run approved rollback migration path (only if validated).
5. Restart dependent services and clear stale workers.
6. Execute smoke tests on critical flows:
   - login
   - patients list/detail
   - AI chat
   - logout
7. Confirm metrics/logs return to baseline.

## Verification Checklist
- [ ] `/health` healthy
- [ ] Critical E2E smoke path works
- [ ] Error rate normal
- [ ] No new security High alerts

## Evidence Record
- Rollback start/end time:
- Operator:
- Restored image tag:
- Related run id:
- Incident ticket:
