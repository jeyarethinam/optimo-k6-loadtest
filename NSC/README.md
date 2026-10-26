# NSC Play booking portal — k6 load tests

Same layout as `ECOM/`: modular endpoints, shared helpers, HTML glass report, failure capture, dated archives.

## Structure

| Path | Role |
|---|---|
| `script.js` | VU flow (Enquiry journey) |
| `data.js` | Origin, fixture IDs, env overrides |
| `load-profile.js` | smoke / vu2 / vu3 / peak* |
| `endpoints/` | auth, catalog, booking |
| `nsc-handle-summary.js` | HTML `report.html` + `summary.json` |
| `run-load-test.js` | Runner (env → k6 → graphs → failures → archive) |
| `profiles/` | Named profile metadata |
| `legacy/` | Recovered Oct 2026 scripts / reports |

## Journey

1. Login → Identity  
2. Asset 586 → Packages → Items (default package **58**, item **2156**)  
3. Availability → zero-cost Price  
4. `POST /bookings` draft → `PATCH` Enquiry → confirmation (status 53)

Cookie session (`noCookiesReset`). **No write retries by default** (`ENABLE_RETRIES=1` to allow).

## Run

```bash
# from repo root — credentials in .env or NSC/.env
npm run smoke:nsc
npm run vu2:nsc
npm run vu3:nsc
npm run peak10:nsc
```

Or:

```bash
node NSC/run-load-test.js smoke
```

Artifacts: `NSC/report.html`, `NSC/summary.json`, `NSC/k6-run.log`, `NSC/failed-requests.*`, dated `report_*.html`.

## Required env

```
NSC_ORIGIN=https://nsc-play-booking-portal.azurewebsites.net
NSC_TEST_EMAIL_1=...
NSC_TEST_PASSWORD=...
```

Optional: `NSC_TEST_EMAIL_2/3`, `NSC_PACKAGE_ID`, `NSC_ITEM_ID`, `NSC_FROM_DATE`, `NSC_TO_DATE`, think-time / p95 limits (see root `.env.example`).

## Safety

- Prefer dedicated UAT accounts (shared accounts invalidate sessions under concurrency).  
- Creates real Enquiries — plan cleanup.  
- High peak profiles need many distinct accounts; do not run peak* against production.
