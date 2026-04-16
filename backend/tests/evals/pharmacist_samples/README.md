# Pharmacist Real Samples

Real-world pharmacist SOAP drafts collected during UAT (P0.4, P6.2).

## File naming

`sample_{NN}_{slug}.md` — e.g. `sample_01_cre_coverage.md`, `sample_02_dose_adjust_renal.md`.

## Each sample contains

```markdown
---
collected_date: YYYY-MM-DD
pharmacist: <initials>
patient_scenario: <one-line>
polish_mode: full | grammar_only
---

## Raw draft

### S
<HIS-pasted verbatim>

### O
<HIS-pasted verbatim, includes labs with reference ranges>

### A
<mixed Chinese/English or broken English>

### P
<bullet draft, pharmacist intent>

---

## Ideal polished version (pharmacist-approved)

### S
<verbatim echo>

### O
<verbatim echo>

### A
<polished — no content change>

### P
<bullets with drug notation + reason→please consider + Monitor>
```

## Status

**Phase 0 (2026-04-17)**: empty — awaiting samples from pharmacist UAT session.
Synthetic seeds live in `../pharmacist_polish_cases.yaml` (Case 1-9) for
wiring up the runner.
