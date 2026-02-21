# T04 UAT Test Script (Core Real-API Flows)

## Scope
- Login / token refresh
- Patients list + patient detail
- Patient board message
- Team chat
- AI chat + session persistence
- Pharmacy advice records

## Preconditions
- Backend service running with PostgreSQL + Redis
- Frontend service running with `VITE_USE_MOCK=false`
- Seed data loaded (`admin / admin` with `SEED_PASSWORD_STRATEGY=username`)
- Browser cache cleared or private window

## Test Cases

| Case ID | Flow | Steps | Expected Result | Evidence |
|---|---|---|---|---|
| UAT-T04-001 | Login | Open `/login`, login with valid account | Redirect to `/dashboard`; no mock error | Screenshot + network log |
| UAT-T04-002 | Patients | Go to `/patients`, click first `檢視` | Redirect to `/patient/:id`; patient blocks render | Screenshot |
| UAT-T04-003 | Board message | In patient detail, switch to `留言板`, send one message | Message appears in list; API `POST /patients/{id}/messages` success | Screenshot + API response |
| UAT-T04-004 | Team chat | Go to `/chat`, send one message | Message appears; API `POST /team-chat/messages` success | Screenshot + API response |
| UAT-T04-005 | AI chat | In patient detail `對話助手`, send one prompt | API `POST /ai/chat` success; assistant response appears | Screenshot + API response |
| UAT-T04-006 | Trend chart | In `檢驗數據`, click one lab item | Trend modal/chart opens; data from `/lab-data/trends` | Screenshot + API response |
| UAT-T04-007 | Pharmacy records | Call advice records page/API | Data source is real API, not mock import | Screenshot + network log |
| UAT-T04-008 | Logout | Click `登出` | Redirect to `/login`, protected route inaccessible | Screenshot |

## Sign-off
- UAT date: 2026-02-20
- Environment: Docker backend (port 8000) + Vite dev (port 3000) + brew PostgreSQL 16 + brew Redis
- Executor: Claude Code (Playwright MCP automated)
- Reviewer: _________________ (PM/QA signature)
- Result: **Pass (8/8)**
- Known issues: None
