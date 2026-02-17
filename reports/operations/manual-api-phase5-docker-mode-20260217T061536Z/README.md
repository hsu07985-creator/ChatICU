# P0-B5 Docker Mode Regression Evidence

Generated at: 2026-02-17T06:20:44Z

## Objective
Validate runtime mode behavior under Docker:
1. Default compose run returns `dataFreshness.mode=db`.
2. Offline override run returns `dataFreshness.mode=json`.

## Environment Isolation
- Compose projects:
  - `chaticu-b5-db`
  - `chaticu-b5-json`
- Additional port override file: `docker-compose.ports.override.yml`

## API Flow (Both Runs)
1. Start stack with `db + redis + api`.
2. Wait for `GET /health`.
3. `POST /auth/login` with `doctor/doctor`.
4. `POST /ai/chat` with `{"patientId":"pat_001","message":"他還好嗎"}`.
5. Extract `.data.message.dataFreshness.mode`.

## Results
- Default run mode: `db` (from `17_db_default_mode.txt`)
- Offline override mode: `json` (from `27_json_override_mode.txt`)
- Assertion: PASS

## Key Evidence Files
- Default run:
  - `11_db_default_up.txt`
  - `13_db_default_health.json`
  - `14_db_default_login.json`
  - `16_db_default_chat_response.json`
  - `17_db_default_mode.txt`
  - `18_db_default_api_logs_tail.txt`
- Offline override run:
  - `21_json_override_up.txt`
  - `23_json_override_health.json`
  - `24_json_override_login.json`
  - `26_json_override_chat_response.json`
  - `27_json_override_mode.txt`
  - `28_json_override_api_logs_tail.txt`
- Compose config snapshots:
  - `30_compose_config_default.txt`
  - `31_compose_config_offline.txt`
