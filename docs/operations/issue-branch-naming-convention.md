# ChatICU Issue / Branch / Commit Naming Convention

## 1. Scope
Applies to integration remediation workstreams (`P0`~`P9`) and follow-up fixes.

## 2. Issue Naming
- Template: `INTG-PXX-<seq>`
- Example: `INTG-P09-001` (P09 E2E managed runner)

Rules:
- `PXX` must map to the remediation phase.
- `seq` uses 3 digits and is unique inside the phase.

## 3. Branch Naming
- Required prefix: `codex/`
- Template: `codex/intg-pXX-<short-kebab-summary>`
- Example: `codex/intg-p09-e2e-managed-runner`

Rules:
- Use lowercase + kebab-case only.
- Keep summary <= 6 words.
- One branch should focus on one phase objective.

## 4. Commit Naming
- Template: `fix(integration): [PXX] <summary>`
- Example: `fix(integration): [P09] isolate local e2e stack`

Rules:
- `[PXX]` is mandatory for remediation tasks.
- Use imperative summary; avoid vague messages (e.g., `update stuff`).

## 5. PR Naming and Linking
- PR title template: `[PXX] <summary>`
- PR description must include:
  - Linked issue IDs (`INTG-PXX-...`)
  - Verification commands run
  - Rollback plan (`git revert <sha>`)

## 6. Hotfix Exception
For urgent production hotfixes:
- Branch: `codex/hotfix-<yyyymmdd>-<summary>`
- Commit may use: `fix(hotfix): <summary>`
- Must add postmortem issue in `INTG-PXX-<seq>` format within 24h.
