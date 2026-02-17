# Manual API Evidence Bundle

## Flow
- Login: `POST /auth/login`
- Fetch patient: `GET /patients?limit=1`
- AI chat: `POST /ai/chat` with explicit `X-Request-ID` / `X-Trace-ID`

## Key Artifacts
- `12_chat3.request.json`: final audited chat request payload
- `12_chat3.body.json`: final audited chat response payload
- `12_chat3.headers`: includes `x-request-id` and `x-trace-id`
- `09_backend_capture_after_logger_fix.log`: full backend runtime log for this run
- `13_backend_log_slice.txt`: extracted lines with request_id and provider capture
- `provider_raw/*.json`: provider raw samples captured by backend
- `provider_raw/masked_sample.json`: masked sample suitable for sharing
- `14_response_snapshot.json`: condensed response quality snapshot

## Acceptance Targets for Blockers
- Backend log with request_id: satisfied by `/ai/chat request_id=...` in `13_backend_log_slice.txt`
- Provider raw response sample (masked allowed): satisfied by `provider_raw/masked_sample.json`
