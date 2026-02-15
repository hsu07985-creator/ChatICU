# T04 UAT Report (Draft)

## Metadata
- Date: 2026-02-15
- Environment (dev/stg/prod): CI + local verification
- Build/Commit: `8c04b3b`
- Run ID (if from CI): `22033862853` / `22033938836` (critical pipeline), `22033478586` (extended journeys)
- Executor: Codex + Dev
- Reviewer: Pending PM/QA sign-off

## Summary
- Total cases: 8
- Passed: 5
- Failed: 0
- Blocked/Pending manual sign-off: 3

## Case Results
| Case ID | Result | Defect ID | Notes | Evidence Link |
|---|---|---|---|---|
| UAT-T04-001 | Pass | - | Login flow verified by critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22033938836 |
| UAT-T04-002 | Pass | - | Patients list -> patient detail verified by critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22033938836 |
| UAT-T04-003 | Pending | - | Message board send/receive requires manual UAT execution and screenshot evidence | `docs/qa/t04-uat-test-script.md` |
| UAT-T04-004 | Pass | - | Team chat route/login/logout verified in extended journey run | https://github.com/jht12020304/ChatICU/actions/runs/22033478586 |
| UAT-T04-005 | Pass | - | AI chat POST `/ai/chat` 200 verified in critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22033938836 |
| UAT-T04-006 | Pending | - | Lab trend click regression test added (`@t27-extended`), waiting CI/manual evidence capture | `e2e/t27-extended-journeys.spec.js` |
| UAT-T04-007 | Pending | - | Pharmacy advice records page/API requires manual UAT screenshot + network log | `docs/qa/t04-uat-test-script.md` |
| UAT-T04-008 | Pass | - | Logout redirect to `/login` verified by critical E2E | https://github.com/jht12020304/ChatICU/actions/runs/22033938836 |

## Defect List
| Defect ID | Severity | Owner | Status | Target Fix Date |
|---|---|---|---|---|
| DEF-T04-20260215-001 | Medium | Frontend | Closed | 2026-02-15 |

- `DEF-T04-20260215-001`: `Objects are not valid as a React child` on lab card render, fixed in `src/components/lab-data-display.tsx` (`8c04b3b`).

## Conclusion
- Release recommendation: Conditional Go (pending 3 manual UAT items + sign-off)
- Remaining risk: Message board/pharmacy/manual lab trend click evidence not yet signed
- Required follow-up:
  1. Execute pending manual UAT cases UAT-T04-003/006/007.
  2. Attach screenshot/network evidence under `docs/qa/evidence/`.
  3. PM/QA complete reviewer signature and close T04.
