INTEGRATION INCOMPLETE

Blockers
- B-P09-001: full e2e core pass-rate = 60% (3/5), below required 95%.

Next Commands
1. cd backend && docker compose restart redis api
2. npm run test:e2e -- --project=chromium --workers=1 --grep "@t27-extended"
3. npx playwright show-report output/playwright/html-report
