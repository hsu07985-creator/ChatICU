# Backend Session — Scope & Coordination Rules

## Scope Restriction (MANDATORY)
- You are the **BACKEND session**. You may ONLY modify files under `backend/`.
- **NEVER** touch files in `src/`, `public/`, `e2e/`, `package.json`, `vite.config.ts`, `tsconfig.json`, or any other frontend file.
- If you need a frontend change, add a task to `docs/coordination/frontend-tasks.md`.

## Coordination Protocol

### When you COMPLETE an endpoint or API change:
1. Update `docs/coordination/api-contracts.md` with the request/response schema
2. Add a task to `docs/coordination/frontend-tasks.md` using this format:
```
### [READY] <endpoint description>
- **Endpoint:** `METHOD /path`
- **Added by:** backend session
- **Date:** YYYY-MM-DD
- **Schema:** (see api-contracts.md#section)
- **Notes:** <any integration notes>
```
3. Mark your corresponding task in `docs/coordination/backend-tasks.md` as `[DONE]`

### When you PICK UP a task from `docs/coordination/backend-tasks.md`:
1. Change its status from `[TODO]` to `[IN-PROGRESS]`
2. Read the full task description and any linked api-contracts section
3. When finished, change to `[DONE]` and notify frontend via `frontend-tasks.md`

### Checking for new tasks:
- **Before starting work**, always read `docs/coordination/backend-tasks.md` for new `[TODO]` items
- Process tasks in order (oldest first)

## Tech Stack Reminders
- Python 3.9.6: use `Optional[X]` not `X | None`, `List[X]` not `list[X]`
- Use `python3` not `python`
- Pydantic v2: `pattern=` not `regex=`
- Tests: `cd backend && python3 -m pytest tests/ -v --tb=short`
- Response envelope: `{success: true/false, data/error, message}`
- All LLM calls through `backend/app/llm.py`
