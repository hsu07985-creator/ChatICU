# Manual API Validation - P1 vital-signs history date filters (with data)

- UTC timestamp: 2026-02-17T04:42:44Z
- Base URL: http://127.0.0.1:8013
- Seeded rows:
  - vs_manual_20260217_a @ 2026-02-16T08:00:00Z
  - vs_manual_20260217_b @ 2026-02-17T08:00:00Z
- Validated endpoint:
  - GET /patients/{patientId}/vital-signs/history?page&limit&startDate&endDate
