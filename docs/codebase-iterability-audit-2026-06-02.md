# Codebase Iterability Audit — 2026-06-02

Consolidated from 12 subsystem surveys + 10 hotspot file deep-dives. Scope: FastAPI backend, React/Vite TS frontend, RAG sidecar, HIS sync. This report ranks what most slows down safe iteration and what to do about it. It does **not** claim anything is broken in production — the focus is change-cost and blast radius.

---

## 1. Executive Summary

### Health per subsystem

| Subsystem | Health | One-line verdict |
|---|---|---|
| backend/app/routers (FastAPI layer) | fair | Works with decent chat/messaging tests, but fat controllers (chat_stream 310 LOC, get_drug_detail 245 LOC), 3x SSE framing, inline role gating, and raw SQL in handlers raise change-cost. |
| backend/app/services | fair | Clean public entry points and good test LOC, but two god-files (duplicate_detector 1942, patient_context_builder 1628) bundle loaders, rule engine, and copy-paste formatters. |
| backend data layer (models/schemas/alembic) | fair | ORM is clean and well-typed; the seam rots — fields duplicated 4x, 7 of 12 Response schemas are dead, 40/82 migrations are seed churn. |
| backend/app/fhir + HIS sync scripts | fair | **Operational hazard**: the forbidden parallel sync script is what launchd and the admin button actually run. 1480-LOC converter has zero unit tests. |
| AI chat / LLM pipeline | fair | Well-documented but dragged by 320 LOC of inline prompt literals, a dead Anthropic path doubling every entrypoint, and triplicated SSE plumbing. |
| backend cross-cutting (middleware/utils/config) | fair | Clean pure utils, but 399-LOC main.py god-file, empty test_middleware/, client-IP copy-pasted 63x (masking a proxy-IP bug), and import-time sys.exit. |
| backend/tests | fair | Good breadth (651 tests), but the HIS sync scripts and the AI-chat SSE happy path have zero coverage, plus a silent-skip that no-ops 40 contract cases. |
| src/pages | fair | Split maturity: patients.tsx models the target, but patient-detail.tsx (1773), advice-statistics (1289), workstation (1104) are god-components; purpose-built hooks sit orphaned. |
| src/components | fair | God-components (medical-records 1333, patient-medications-tab 1313) and patient-detail.tsx prop-hub (25-32 props/tab); formatters triplicated. |
| src/lib (API client/cache) | fair | Solid client core, but an orphaned 4249-LOC generated-types file and split-brain caching (3 bespoke caches alongside TanStack Query) mislead about source of truth. |
| src/hooks, i18n, features | fair | i18n is healthy and parity-exact; hooks layer has orphaned dead code, triplicated streaming, and a hardcoded `canSendAiChat = true` dead flag. |
| RAG (func/) + scripts + drug_api | fair | Deployed core is clean; peripheries are dead weight — vendored RAG-Anything (~5300 LOC, 0 imports), untracked drifted drug_api/ fork, zombie .pyc dirs, banned sync script still tracked. |

No subsystem is "good"; none is "poor". The codebase is uniformly **fair** — functional and unusually well-commented, but consistently taxed by the same handful of patterns.

### Themes that most slow iteration

1. **God-files / fat controllers everywhere.** The same anti-pattern recurs across both stacks: duplicate_detector.py (1942), patient-detail.tsx (1773), patient_context_builder.py (1628), his_converter.py (1481), ai_chat.py (1433), medical-records.tsx (1333), patient-medications-tab.tsx (1313), advice-statistics.tsx (1289), drug_library.py (1414). Each bundles 5-8 unrelated concerns, so any change requires re-reading hundreds of lines and risks unrelated breakage.

2. **Extracted-but-orphaned abstractions = worst of both worlds.** The frontend already has the refactor targets built — `use-ai-chat-conversation.ts` (376), `use-patient-bundle.ts` (261), `use-chat-sessions.ts` (206) — but they are imported by **nobody**, while the giant pages reimplement the same logic inline. ~640-660 LOC of unmaintained abstraction silently drifting from the inline copies actually shipping.

3. **Duplication of cross-cutting plumbing instead of shared helpers.** SSE framing reimplemented 3x backend + 3x frontend; AI streaming loop copied 3x; role gating hand-rolled across ~8 routers; client-IP extraction 63x; ApiResponse<T> redeclared 19x; the response envelope helper bypassed in ai_chat/pad_calculate. A single protocol/contract change becomes a multi-site edit.

4. **The documented "do not use this" path is the wired-up one.** CLAUDE.md's single most load-bearing operational rule (use serial HIS sync, the parallel one silently writes nothing) is contradicted by the actual wiring: `run_his_snapshot_sync.sh` and the admin button run the **forbidden** parallel script. This is the only finding with a path to silent production data loss.

5. **Clinical safety logic and high-churn paths are the least tested.** his_converter (1480 LOC of clinical mapping), the AI-chat SSE happy path, the HIS sync scripts, drug_library governance, and the duplicate-detection regex heuristics duplicated into the meds-tab view all rely on manual QA. These are exactly the patient-safety-relevant and highest-churn surfaces.

---

## 2. Top 10 Highest-Leverage Actions (impact ÷ effort)

Ranked by leverage. "Effort" is the surveyor estimate (S ≤ ~1hr, M ≤ ~1 day, L = multi-day).

1. **Point the HIS sync wrapper at the serial script (or delete the parallel one).** `backend/scripts/run_his_snapshot_sync.sh:25`, `backend/app/routers/admin_his_sync.py:29,35`. Effort: **M** (also adjust the summary regex, which already only matches the parallel output). *Why:* closes the one silent-data-loss footgun where the documented-banned script is what launchd and the admin button actually execute. Highest impact in the report.

2. **Delete or wire the orphaned frontend hooks.** `src/hooks/use-ai-chat-conversation.ts:25`, `use-patient-bundle.ts:101`, `use-chat-sessions.ts`. Effort: **M**. *Why:* ~640 LOC drifting from the inline copies in patient-detail.tsx/ai-chat.tsx. Adopting them is the highest-leverage frontend cleanup because the refactor target already exists — it simultaneously shrinks the 1773-LOC god-page and kills the triplicated streaming loop.

3. **Delete the orphaned 4249-LOC generated types file.** `src/lib/api/types.generated.ts:1-4249`. Effort: **S**. *Why:* 35% of lib LOC, zero imports, no `gen:types` script, already diverged from the hand-rolled types it appears to authorize. It actively misleads new contributors about the source of truth. Either delete or wire a real codegen script.

4. **Extract one SSE helper per stack.** Backend: `clinical.py:279-355,720-812`, `ai_chat.py:497-733`. Frontend: `src/lib/api/ai.ts:384-470,609-665,852-905`. Effort: **M**. *Why:* frame format + headers + done-frame heuristic live in 3 places each; a protocol change (retry:/id:, hardened sentinel) becomes one edit. Removes the only `any` casts in ai.ts.

5. **Standardize role gating on the existing `require_roles` dependency.** Delete `_require_pharmacist/_require_admin` in `drug_library.py:182-184,1049-1051` and inline `role not in (...)` checks in `messages.py:169,303,517,559`, `team_chat.py:280,382`, `clinical.py:604,685`, `record_templates.py:99-211`. Effort: **M**. *Why:* clinical-app authorization should be auditable in one place; today it's scattered with inconsistent EN/ZH messages.

6. **Replace hand-rolled `{"success": True}` dicts with `success_response()`.** `ai_chat.py:1116,1169,1222,1268,1352,1428`, `pad_calculate.py:273,297`. Effort: **S**. *Why:* 31 routers already use the helper; these 8 sites would silently miss any future envelope change (e.g. adding `meta`/`trace_id`). Same fix on the frontend: replace the 19 local `ApiResponse<T>` redeclarations with the canonical import from `api-client.ts`.

7. **Add a table-driven test suite for HISConverter pure functions.** `backend/tests/test_fhir/test_his_converter.py` (new), covering `_roc_to_date`, `_clean_drug_name`, `_classify_san/_classify_category`, `_parse_dnr_consent`, lab category remap, culture pairing. Effort: **M**. *Why:* 1480 LOC of clinical mapping with zero direct tests; input/output examples already exist in the docstrings. Every silent mapping regression flows straight to clinician-facing data — highest-leverage safety net in the backend.

8. **Add a `/ai/chat/stream` happy-path test with a stubbed LLM.** `backend/tests/test_api/` (new). Effort: **M**. *Why:* the highest-churn router (1433 LOC; recent commits: citation audit, conflict detection, snapshot citations) has only an error-contract test. citation_audit/assertion_conflict are unit-tested in isolation but never wired through the route, so a router-level regression ships green.

9. **Make `config.py` import side-effect-free.** Move JWT_SECRET fail-closed validation out of import-time `sys.exit(1)` (`config.py:136-157`) into a `validate_settings()` called from lifespan startup. Effort: **M**. *Why:* today any import (alembic env, scripts, test collection) triggers full env load + process exit on a missing secret, forcing tests/tooling to set env before first import.

10. **Promote `_get_client_ip` to a shared util and fix the proxy-IP bug once.** `rate_limit.py:5` → `app/utils/request.py`, replacing 63 inline `request.client.host if request.client else None`. Effort: **S**. *Why:* behind Vercel/Railway proxies `request.client.host` is the proxy IP, so **every audit-log IP is currently wrong**; centralizing also lets X-Forwarded-For handling be added in one place instead of 63.

---

## 3. Quick Wins (≤1hr each)

### Dead-code / orphan removal
- Delete `scripts/layer1/` and `scripts/layer2/` — only orphaned `__pycache__` .pyc files, sources gone.
- Delete (or wire `gen:types`) `src/lib/api/types.generated.ts` — 4249 LOC, zero imports.
- Delete the 7 unused camelCase Response schemas (Patient/Medication/MedicationAdministration/Message/TeamChat/VitalSign/LabData) — 0 router references and would silently null fields if used.
- Remove/archive `backend/scripts/sync_his_snapshots.py` (CLAUDE.md-banned); if kept, rename `.DEPRECATED.py` + `raise SystemExit` at top.
- Move untracked `drug_api/` out of the tree — self-described non-runnable copy that already drifted (`duplicate_detector.py`, `backfill_drug_interactions_atc.py`).
- Delete/wire the hardcoded `canSendAiChat = true; aiChatGateReason = ''` dead flag and its prop chain (`patient-detail.tsx:911-912` → `patient-chat-tab.tsx:131`).
- Remove dead imports in `drug_library.py` (DrugInteraction, func/or_/select, defaultdict, datetime/timedelta/timezone, List, Body) + add ruff F401 to CI.
- Replace the no-op ternary `chosen = ipd_rows[-1] if len==1 else ipd_rows[-1]` (`his_converter.py:682`).

### Dedup pure helpers
- Delete the triplicated `formatDoseValue`/`formatMedicationRegimen` in `patient-medications-tab.tsx:39` and `patient-detail.tsx:325`; import from `patient-detail-utils.ts` (already exported, already drifted).
- Stop passing stateless formatters (`formatTimestamp`/`formatDisplayValue`/`formatDisplayTimestamp`/`formatMedicationRegimen`) as props — import directly (removes 4-5 props/tab).
- Collapse the 4 identical `should_prefetch_*` functions (`ai_question_prefetch.py:188-205`) into one keyword-matcher factory.
- Collapse the 3 identical Set-toggle reducers (`use-chat-ui-state.ts:30-55`).
- Dedupe the `MedicationGroups` interface (3 identical copies: `patient-detail.tsx:176`, `use-patient-detail-view-model.ts:5`, `use-patient-bundle.ts:24`).
- Hoist `polishTypeMap` (defined twice: `medical-records.tsx:578,636`) to a module const.

### Envelope / consistency
- `success_response()` for the 8 hand-rolled dicts (ai_chat ×6, pad_calculate ×2).
- Canonical `ApiResponse<T>` import to replace 19 local redeclarations.
- Hoist the valid-role set into one constant/Enum (fixes existing `'np'` drift in `user.py:20`).
- Move `escape_like` out of `response.py` into a SQL/security util; drop the unused `status_code` param on `error_response`.

### Convention / i18n / no-emoji
- Replace emoji badges in `duplicate_check.py:31-37` (`🔴🟠🟡🔵⚪` in LLM prompt text) with text severity labels — contradicts the documented no-emoji pharmacy convention.
- Route `'AI 功能未就緒'` (`patient-chat-tab.tsx:648`), `'未標示日期'`/`'PRN'`/`'STAT'` (`patient-medications-tab.tsx:92,1080`) through `t()`.
- Add `timeZone:'Asia/Taipei'` to the advice-record timestamp (`advice-statistics.tsx:971`) — same page already does it for SOAP at :1108 (Taipei-time rule).

### Low-risk correctness
- Retain fire-and-forget task refs in `audit_async.py:58`; swap `asyncio.get_event_loop()` → `get_running_loop()` in `main.py:349`.
- Stop mutating cached HIS rows in `_load_all` (`his_converter.py:554-570`) — inject `_source_factory` into a shallow copy.
- Memoize `convert_patient()` (`his_converter.py`) — recomputed ~8x/patient on the 4-5min/patient hot path.
- Replace the conditional `pytest.skip('DuplicateDetector not yet importable')` (`test_duplicate_detector.py:159-161`) with a top-level import so broken imports fail loudly instead of silently skipping 40 contract cases.

---

## 4. Structural Debt (larger refactors)

### A. The dual HIS sync-script situation (do this first — operational risk)
**Problem:** CLAUDE.md forbids `sync_his_snapshots.py` (asyncio+pooler silent write-fail: reports `synced=14,errors=0` but writes nothing) and mandates the serial variant. But `run_his_snapshot_sync.sh:25` (launchd + admin button) execs the **forbidden** script; the safe serial one is reachable only by hand. The two drivers also duplicate `get_database_url`/`load_state`/`classify`, and **resolve different databases** (serial reads `.env.his-sync` then `.env`; parallel reads only `.env`); the serial version dropped the post-sync duplicate-cache refresh hook.
**Approach:** (1) immediately repoint the wrapper at serial + fix the admin summary regex; (2) collapse the two drivers into one module that imports shared helpers (URL/state/classification/SnapshotInfo iteration) and selects serial-vs-parallel as a flag, eliminating env-resolution divergence; (3) add integration tests asserting actual DB persistence/commit against the in-memory engine.
**Sizing:** wrapper fix M; driver consolidation M; tests L.

### B. Backend god-file splits
- **`duplicate_detector.py` (1942 → package).** Split into `models.py` (DTOs), `knowledge.py` (curated clinical constants — the most-edited, highest-leverage isolation), `loaders.py` (RuleRepository, DB+CSV — currently 6 near-identical methods, ~320 LOC), `matching.py` (pure helpers), `stacking.py` (L3 callables), `detector.py` (orchestration). Re-export from `__init__` so the 5 consumers/tests don't change. Also: replace untyped `Dict[str,Dict[str,Any]]` group dicts with `@dataclass MechanismGroup/EndpointGroup` (kills ~12 string-keyed silent-None access sites + the `# type: ignore` severity casts via a Severity enum). **Highest-leverage backend refactor.** Sizing: L.
- **`patient_context_builder.py` (1628 → package).** Clean horizontal seams already exist (the `# ──` banners map ~1:1). Split into `repository.py` (async `_get_*`), `lab_values.py`, `safety.py` (allergy/dup — highest-risk, deserves isolated tests), `formatters.py` (pure `_fmt_*`), `builders.py`. Extract a single `_assemble_snapshot(...)` shared by `build_clinical_snapshot` and `build_critical_snapshot` (they duplicate the entire section-assembly sequence — a snapshot layout change is currently a 2-place hand-synced edit in the most safety-critical output). Table-drive `_fmt_lab_section` (135-LOC hand-unrolled block). Wrap the connection-warmup-before-gather invariant in a tested helper. Sizing: L.
- **`his_converter.py` (1481 → `his/` package).** `roc_time.py`, `drug_dictionaries.py`, `lab_dictionaries.py`, `resources.py`, `snapshot_io.py`, thin `his_converter.py`. Migrate the ~420 hand-maintained drug-name substrings (3 parallel lists: `_SAN_PATTERNS` vs `_classify_category` overlap on ~11 names) onto the now-existing ATC formulary, keeping substring matching as documented fallback. Add unmapped-code telemetry (mirror the existing med ATC coverage report) so silent "other"-bucket drift surfaces. **Pair with the test suite (action #7) — split makes the pure helpers trivially testable.** Sizing: L.
- **`ai_chat.py` (1433 → thin router + services).** `services/ai_chat/sse.py` (already has test_sse_heartbeat.py — clean seam), `prompt_assembly.py` (collapse the 4 `_maybe_inject_*` helpers that each rsplit on the `[使用者提問]` marker — most cache-sensitive code; an in-file note documents a 70%→0% cache regression from exactly such a mutation), `snapshot_lifecycle.py` (extract the snapshot-build block copy-pasted between `chat_stream:794-835` and `refresh_session_snapshot:1312-1344`), `observability.py`. Split `_event_stream` (257 LOC) into a pure transport generator + post-stream side-effect functions (persist/audit/metrics). Sizing: L.
- **`drug_library.py` (1414 → package).** `atc_labels.py` (140 LOC pure data), `formulary.py`, `aggregation.py` (the unit-test-worthy catalog logic), `audit.py`, and three separate routers (catalog/editor/override). Extract `parse_interacting_members(raw)` (the str/list/dict JSON ladder duplicated at `:342-368` and `:640-665`). Add API tests for the propose→approve→clear-override governance lifecycle + role gates (currently zero). Sizing: L.
- **`llm.py` (1012 → package).** `prompts.py` (~320 LOC of clinical prompt prose → ideally external `.md` assets loaded at import, enabling diff-friendly review/versioning and non-substring tests), `clients.py`, `audit.py`, `providers/{openai,anthropic}.py`. Collapse the 6 copy-paste call functions (single-turn = multi-turn with one message) and the 3-way dispatch into a provider-adapter registry. **Decide the Anthropic question:** project is OpenAI-only with no budget — either delete the ~150 LOC of untested Anthropic branches or isolate them behind a clearly-marked optional adapter, instead of interleaving them in every entrypoint. Sizing: M-L.
- **`main.py` (399 → ~80).** Extract `logging_config.py`, `middleware/security_headers.py`, `middleware/error_handlers.py` (+ webhook alerting). Makes CSP/security-headers independently testable (currently no test). Sizing: M.

### C. Frontend god-component / architecture debt
- **`patient-detail.tsx` (1773).** Adopt `usePatientBundle` for data + the extracted chat hook for messaging; extract `usePatientMessageBoard`; move module-scope formatters to `lib/patient-detail-format.ts`; pass hook objects/context instead of ~45 flattened props to `PatientChatTab`. Target a ~300-LOC orchestrator like `patients.tsx` already models. Sizing: L.
- **`medical-records.tsx` (1333).** Land low-risk pure extractions first: `lib/medical-records/draft-storage.ts` (localStorage persistence + the process-global `quotaToastShown` + a version tag/migrate — currently untestable inside React, data-loss-critical) and `templates.ts`; then `useDrafts`/`useClinicalPolish` hooks + `TemplatePopover`/`DraftPolishPanes`. Reconcile the `RecordType`/`RecordTemplateType` union (6+ scattered casts). Sizing: M-L.
- **`patient-medications-tab.tsx` (1313).** Extract `lib/medications/duplicate-overlap.ts` (`medCompareKey`+`detectDuplicates` — fragile untested regex heuristics that may disagree with the shared `DuplicateDetector` the team standardized on; the file itself notes "a different check") + unit tests; decide the dead `canEditMedication = false` edit path (~120 LOC unreachable). Sizing: M.
- **`advice-statistics.tsx` (1289).** Extract `computeAdviceStats(records)` (currently unmemoized in render body, with an O(n²) `records.find` inside `.map`) + `useMemo`; extract `AdviceCharts`/`SoapTab`/form components + a `useAdviceDeepLink` hook. Sizing: L.
- **Establish one page architecture** (thin page + `use-<page>.ts` + `hooks/<domain>/*`, per `patients.tsx`) and migrate the pharmacy giants onto it.

### D. Frontend caching split-brain
Three bespoke module-singleton caches (`patients-cache.ts` 5min+pub/sub, `pad-drugs-cache.ts` 30min, `team-chat-cache.ts`) run **alongside** TanStack Query (already present). An entity can be fresh in Query and stale in the singleton. The `patients-cache` TTL footgun (HIS sync writes DB directly, cache unaware → stale lists until hard refresh; correctness depends on every mutation remembering `invalidatePatients()`) is documented in CLAUDE.md. **Approach:** consolidate onto TanStack Query (`staleTime`/`gcTime`/`invalidateQueries`), or at minimum factor a `createStaleCache(fetcher,ttl)` and have mutations invalidate internally + add a `visibilitychange` refetch. Sizing: M.

### E. The 4249-LOC generated types question
`types.generated.ts` is zero-imported, has no codegen script, and already diverged from hand-rolled interfaces. **Decide:** (a) delete it (recommended — it's stale and misleading), or (b) wire a real `openapi-typescript` `gen:types` script and migrate modules onto `components['schemas'][...]`. Don't leave it as authoritative-looking dead weight. Sizing: S (delete) / M (wire).

### F. The RAG-pipeline dead-weight question
`func/raganything/` is a verbatim-vendored HKUDS RAG-Anything v1.2.9 (`__version__="1.2.9"`, original author/URL), ~5300 LOC across 3 god-files, **zero local commits, zero tests, zero imports from the shipped backend** (Procfile runs only `uvicorn app.main:app`). This is a 37MB third-party sidecar, not first-party code to maintain. **Approach:** either pin it as a dependency (`raganything==1.2.9` in `func/requirements.txt`) or relocate the tree to `_archive_candidates/`. At minimum add a `VENDORED` top-of-file marker so nobody refactors it. Sizing: S-M. *Do not audit these lines as code to maintain.*

### G. Data-layer serialization seam
Adding/renaming a Patient field today is a 4-edit ritual (model / Create-Update / Response / `*_to_dict`). **Pick one path:** drive responses through Pydantic with `alias_generator=to_camel` + `response_model` (deleting the 20 `*_to_dict` mappers), *or* keep mappers and delete the redundant Response schemas — not both. Also: split alembic into schema-only migrations vs a re-runnable seed script (40/82 are seed/reseed/force/clear churn reflecting prior silent-fail incidents); standardize FK `ondelete` on `patients.id`. Sizing: L / M / M.

---

## 5. Hotspot File Breakdown

| File | LOC | Mixed responsibilities | Recommended split |
|---|---|---|---|
| `backend/app/services/duplicate_detector.py` | 1942 | DTOs+serialization, curated clinical knowledge, DB/CSV loaders, L1-L4 detection, rule engine, pure utils, input normalization | `duplicate_detector/` package: models / knowledge / loaders(RuleRepository) / matching / stacking / detector; `@dataclass` group types |
| `backend/app/services/patient_context_builder.py` | 1628 | ~12 async fetchers, JSONB extraction, `_fmt_*` renderers, allergy/dup safety logic, 3 snapshot builders, delta diff, embedded vocab | `patient_context/` package: repository / lab_values / safety / formatters / builders + `clinical_vocab.py`; shared `_assemble_snapshot` |
| `backend/app/fhir/his_converter.py` | 1481 | ROC date parsing, drug/lab lookup tables, name-cleaning regex, FS snapshot IO+cache, import-time resource loads, 7-entity conversion | `his/` package: roc_time / drug_dictionaries / lab_dictionaries / resources / snapshot_io + thin converter; ATC-driven classification |
| `backend/app/routers/ai_chat.py` | 1433 | routing+schemas, session CRUD, snapshot lifecycle, prompt assembly+4 injectors, SSE plumbing, hedge/cache metrics, inline audit/conflict | thin router + `services/ai_chat/{sse,prompt_assembly,snapshot_lifecycle,observability}`; `routers/ai_sessions.py` |
| `backend/app/routers/pharmacy_routes/drug_library.py` | 1414 | ATC label data, formulary loader, read-side aggregation, 3 catalog endpoints, Phase-4a editor, Phase-4b override/4-eye workflow | `drug_library/` package: atc_labels / formulary / aggregation / audit + catalog/editor/override routers |
| `backend/app/llm.py` | 1012 | ~320 LOC prompt prose, client singletons, 6 provider call fns, 3-way dispatch, audit/observability, embeddings | `llm/` package: prompts(→.md) / clients / audit / providers/{openai,anthropic}; unify single+multi-turn, adapter registry |
| `src/pages/patient-detail.tsx` | 1773 | bundle loading, AI chat engine, session CRUD, message board, pure formatters, edit-save, layout/tabs (50 useState) | adopt orphaned `usePatientBundle`/`useAiChatConversation`/`useChatSessions`; extract message-board hook + format lib + header |
| `src/components/medical-records.tsx` | 1333 | localStorage drafts, template engine, AI polish streaming, i18n config, clipboard, full presentation (2 UIs) | `lib/medical-records/{draft-storage,templates}` + `useDrafts`/`useClinicalPolish` + `TemplatePopover`/`DraftPolishPanes` |
| `src/components/patient/patient-medications-tab.tsx` | 1313 | 12 formatters, score UI, duplicate-detection logic, detail modal, S/A/N card, edit form (dead), tab orchestration | `medication-formatters.ts` + `lib/medications/duplicate-overlap.ts` + score-selector / detail-modal / edit-dialog / san-card components |
| `src/pages/pharmacy/advice-statistics.tsx` | 1289 | patient cache, month selector, create/edit/delete forms, inline stats derivation, 3 charts, history+search+F3 deep-link, SOAP tab | `useAdviceStatistics` + `computeAdviceStats` + form/dialog components + `AdviceCharts`/`SoapTab` + `useAdviceDeepLink` |

---

## 6. Testing Gaps (gate safe iteration)

Ordered by risk. These are paths where a regression ships green.

1. **HIS sync scripts — zero tests on the exact documented silent-fail class.** `sync_his_snapshots_serial.py`, `import_his_patients.py`. The persistence layer (`snapshot_sync.merge_patient_payload`) is tested, but the orchestration that decides what to commit is not. CLAUDE.md documents a prior production data-loss incident here. Add integration tests asserting rows actually **persist/commit** against the in-memory engine with a fixture snapshot dir. (effort L)

2. **his_converter.py — 1480 LOC of clinical mapping, zero direct unit tests.** `_roc_to_date`, `_clean_drug_name`, `_classify_san/_classify_category`, `_parse_dnr_consent` bitmask, lab category remap, culture isolate/colony pairing, `_build_ecg_impression`. Pure functions with input/output examples already in docstrings. Every silent mapping regression reaches clinician-facing data. (effort M)

3. **AI chat `/ai/chat/stream` — only an error-contract test, no happy path.** Highest-churn router (1433 LOC). No test asserts the success SSE token stream, that citation_audit/assertion_conflict run **inline through the route** (they're tested only in isolation), or that snapshot citations are required. Stub the LLM and assert framing + that audit/conflict hooks fire. (effort M)

4. **Silent skip no-ops 40 duplicate-detector contract cases.** `test_duplicate_detector.py:159-161` — `if DuplicateDetector is None: pytest.skip(...)`. The module is fully implemented; any future ImportError now reports SKIPPED, not FAILED. Replace with a top-level import. (effort S)

5. **drug_library governance lifecycle — zero tests on safety-relevant pharmacy rules.** propose/approve/reject/withdraw/verify/deprecate/restore + `_validate_override` change clinical DDI risk ratings but are exercised only manually. Add propose→approve→clear-override + role-gate tests before further changes. Same gap for `medication_duplicates.py`, `message_activity.py`, `fhir_export.py`. (effort M)

6. **Empty `tests/test_middleware/`.** The most security-sensitive cross-cutting code has no direct tests: JWT idle-timeout/blacklist (`auth.py:176-196`), fail-closed JWT_SECRET (`config.py:148-157`), SecurityHeadersMiddleware CSP branches, and pure utils `word_match`, `build_data_freshness`, and `array_contains_user_receipt`'s NULL-coercion (`jsonb_compat.py:50-77`, whose docstring flags a previously-shipped "read by everyone" bug). (effort M)

7. **Frontend clinical logic buried in views, untestable without rendering.** `medCompareKey`/`detectDuplicates` (patient-medications-tab — a mis-keyed generic is a patient-safety miss), `computeAdviceStats`, medication grouping/sorting, the rAF chat-stream loop. Extract to lib modules (Structural Debt C) then unit-test. (effort L)

### Cross-cutting test-infra debt
- **No shared model factories** — ~70 inline `User()`/`Patient()`/`Medication()` constructions; a new NOT NULL column breaks all of them independently. Add `make_user/make_patient/make_medication`. (effort M)
- **AsyncMock session helper duplicated across 4 suites** — promote `mock_async_session` to conftest. (effort S)

---

## Notes on conflicts / uncertainty in the source data
- The hotspot deep-dive and the AI-chat subsystem survey give slightly different line ranges for `chat_stream`/`_event_stream` (e.g. 734-1044 vs 735-1044; 473-733 vs 473-729). These are rounding differences in the same blocks, not contradictions.
- `patient-detail.tsx` is reported as 1773 LOC consistently, but the count of "dead chat hooks" varies (637 vs 656 vs ~660 LOC) depending on whether `use-chat-ui-state.ts` (74) is included. The action is the same regardless: adopt or delete.
- `backend/CLAUDE.md` reportedly mandates Python 3.9 typing (`Optional[X]`, `List[X]`) while `patient_context_builder.py` already uses PEP 585 builtins (`tuple[...]`, `set[str]`) and the local interpreter is 3.14 — an internally-contradictory convention. Resolve the floor before mass-migrating typing, or new edits will be whipsawed.
- Whether `medCompareKey`/`detectDuplicates` in the meds-tab is *reinventing* the shared `DuplicateDetector` or *intentionally* a different check is unresolved in the data — the file comments claim "a different check"; confirm with the PM before merging the two paths.
