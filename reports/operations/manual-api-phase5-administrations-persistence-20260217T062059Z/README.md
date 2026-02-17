# P0-A6 Manual API Persistence Evidence

Generated at: 2026-02-17T06:22:50Z

## Objective
Verify medication administration updates persist across API restart.

## Scenario
- Patient: `pat_001`
- Medication: `med_001`
- Administration row: `adm_med_001_02`
- Patch payload: `{"status":"held","notes":"P0-A6 persistence verification"}`

## Steps
1. Start isolated Docker stack (db mode).
2. Login and fetch administrations (baseline).
3. PATCH target administration.
4. Fetch administrations (post-patch).
5. Restart API container.
6. Login again and fetch administrations (post-restart).
7. Compare key fields between post-patch and post-restart.

## Result
- Post-patch assertion: PASS (`23_assert_after_patch.txt`)
- Post-restart assertion: PASS (`24_assert_after_restart.txt`)
- Key-field diff after patch vs after restart: empty (`27_diff_after_patch_vs_after_restart.txt`)

## Key Evidence Files
- Baseline row: `15_target_row_before_patch.json`
- Patch request: `16_patch_request.json`
- Patch response: `17_patch_response.json`
- Post-patch row: `18_target_row_after_patch.json`
- Restart proof: `19_restart_api.txt`
- Post-restart row: `22_target_row_after_restart.json`
- Comparison files: `25_key_fields_after_patch.json`, `26_key_fields_after_restart.json`, `27_diff_after_patch_vs_after_restart.txt`
- API logs snapshot: `28_api_logs_tail.txt`
