# Contributing Guide

Thanks for contributing to ChatICU.

## Development Principles

- Keep API contracts explicit and backward-compatible unless a breaking change is approved.
- Prefer deterministic behavior over implicit fallback logic.
- Add tests for every behavior change.
- Keep security defaults fail-closed.

## Local Setup

1. Install dependencies:

```bash
npm ci
cd backend && pip install -r requirements.lock
```

2. Configure backend environment:

```bash
cd backend
cp .env.example .env
```

3. Run migrations and seed (if needed):

```bash
cd backend
python -m alembic upgrade head
SEED_PASSWORD_STRATEGY=username python -m seeds.seed_if_empty
```

## Branch and Commit Conventions

- Branch naming: `feature/*`, `fix/*`, `docs/*`, or `ai/*`
- Commit format:
  - `feat(scope): ...`
  - `fix(scope): ...`
  - `docs(scope): ...`
  - `test(scope): ...`

## Required Checks Before PR

Run all relevant checks locally:

```bash
# Frontend
npm run typecheck
npm run build

# Backend
cd backend
pytest tests/test_api -q
python -m seeds.validate_datamock
```

## Pull Requests

- Keep PRs focused and small.
- Include why the change is needed, not only what changed.
- Link related issues (for example: `Closes #27`).
- Attach validation evidence for API/data-flow changes.

## Coding Standards

- Python: follow project linting and type expectations.
- TypeScript: keep API types strict; avoid unsafe non-null assertions on API payloads.
- Avoid introducing test-only logic into production code paths.

## Security

- Do not commit secrets.
- Follow `SECURITY.md` for vulnerability handling and key rotation.
