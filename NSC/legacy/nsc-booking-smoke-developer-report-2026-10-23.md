# NSC UAT booking portal — single-user booking smoke (pass)

**Prepared:** 23 October 2026  
**Purpose:** Record a successful one-user write smoke of the customer booking Enquiry journey on current UAT, and note catalogue drift since the October 5 load-test fixtures.  
**Status:** Passed. One zero-cost Enquiry created and confirmed. Not a capacity or concurrency result.

## Executive summary

A single virtual user completed the full booking write journey against the NSC Play UAT customer booking portal: login, identity, asset/package/item reads, availability and zero-price checks, temporary draft creation (`POST /bookings`), Enquiry submit (`PATCH /bookings/{id}`), and confirmation GET. All ten HTTP requests returned success; 23 checks passed; k6 exit code was 0. Journey time was 13.766 seconds including 0.25 s inter-request pauses.

The recovered October 5 scripts expected package **113** (`Ceremonies Test Package`). That package is no longer returned for this account. The smoke selected package **58** (`EPOS - Ceremonies - Excluding Catering`). Item **2156** (Low Impact / Under 15 people) remains available on asset **586** and still prices at AU$0.00 under the authenticated concession. An earlier attempt aborted at the package-eligibility assert before any write; no draft was created on that aborted run.

This run establishes that the current one-user Enquiry path works end-to-end. It does not retest the three-user draft-creation HTTP 500 reported on 5 October 2026.

## Endpoint and journey

- **Environment:** NSC Play UAT customer booking portal, `https://nsc-play-booking-portal.azurewebsites.net/bookingportal/`
- **API base:** `https://nsc-play-booking-portal.azurewebsites.net/bookingportal/api`
- **Journey:** Create a temporary booking draft for asset 586 (space), package 58 (EPOS - Ceremonies - Excluding Catering), item 2156 (Low Impact / Under 15 people), one attendee, 30-minute slot. Calculated and submitted total AU$0.00; submitted status Enquiry (id 53). No payment call is part of this flow.
- **Accounts:** One UAT customer identity. Credentials are intentionally not included in this report.
- **Safety behavior:** Hard booking cap of 1; exact smoke run-token required; no retry on a write; automatic abort on the first failed request/check.

## Run observations

| Run | Local time (UTC+05:30) | Result | Booking name | Slot | Reference / id |
|---|---|---|---|---|---|
| `NSC-SMOKE-20261023-1718` | ~17:18 | Aborted before write | — | — | Package 113 not found / eligibility assert failed |
| `NSC-SMOKE-20261023-1720` | ~17:20 | Pass (exit 0) | `NSC-SMOKE-20261023-1720-VU1-I1` | 2026-11-03 11:00–11:30 | **IB16208** / `16208` |

Successful step timings from the 1720 event log (HTTP status 200 throughout):

| Step | Duration |
|---|---:|
| login | 1,715 ms |
| identity | 469 ms |
| asset | 464 ms |
| packages | 464 ms |
| items | 609 ms |
| availability | 807 ms |
| price | 599 ms |
| create_draft (`POST /bookings`) | 1,909 ms |
| submit_enquiry (`PATCH /bookings/{id}`) | 1,808 ms |
| confirmation (`GET /bookings/{id}`) | 892 ms |

Confirmation returned `bookingStatus` `{ id: "53", name: "Enquiry", stockAllocated: true, parentBookingStatusID: 2 }`, `totalAmount: 0`.

## Run-level results

| Measure | Aborted probe (`1718`) | Successful smoke (`1720`) |
|---|---:|---:|
| Duration | ~5.9 s (abort) | 13.766 s journey / ~13.8 s wall |
| Maximum VUs | 1 | 1 |
| Iterations completed | 0 (interrupted) | 1 |
| HTTP requests (completed journey) | — (stopped after packages) | 10 |
| HTTP failures | 0 (logic abort) | 0 |
| Checks passed / failed | — | 23 / 0 |
| Overall request p95 | — | 1,864 ms |
| Maximum request duration | — | 1,909 ms (create_draft) |
| Completed zero-cost Enquiries | 0 | 1 |

This is a single-user functional smoke, not a load or capacity test. Thresholds used: all checks pass, zero HTTP failures, overall p95 &lt; 5 s, submit-enquiry p95 &lt; 6 s. All thresholds passed on `1720`.

## Catalogue drift since 5 October fixtures

| Fixture (5 Oct scripts / report) | Observed 23 Oct (this account) |
|---|---|
| Package 113 — Ceremonies Test Package | Not present in `/products/private-packages?assetId=586` |
| — | Package 58 — EPOS - Ceremonies - Excluding Catering (`isEligible: true`, empty `packageItems`) |
| Item 2156 — Low Impact / Under 15 | Still present; still AU$0.00 with concession group 8 |
| Asset 586 | Unchanged |

Read-only package probe also showed other eligible packages (e.g. 102 Ceremonies Including Catering, 57 Large Private Gathering). Medium-impact item 2157 priced at AU$880.00 for the same probe slot; it was not used.

## Created test record and cleanup

- Created: reference **IB16208**, bookingId **16208**, name `NSC-SMOKE-20261023-1720-VU1-I1`, slot 2026-11-03 11:00–11:30, Enquiry, AU$0.00.
- Cleanup: **not performed** as part of this smoke. Cancel or leave as agreed with UAT owners. Prefer Booking Manager if notification suppression is required; the customer cancel API has no confirmed no-email flag (see `nsc-booking-api-map.md`).

## What the client evidence does and does not show

**Observed:** one-user Enquiry create/submit/confirm succeeds on current UAT with package 58 / item 2156 / asset 586; historical package 113 is absent for this identity; draft and submit latencies were under 2 seconds each on this run.

**Not established:** multi-user concurrency behaviour; reproduction or disposition of the 5 October three-user `POST /bookings` HTTP 500; payment flows; staff Booking Manager equivalence; email/notification side effects of Enquiry creation.

## Evidence files

- Smoke script: [nsc-k6-booking-smoke.js](nsc-k6-booking-smoke.js)
- Successful run metrics: [nsc-k6-booking-smoke-results-NSC-SMOKE-20261023-1720.json](nsc-k6-booking-smoke-results-NSC-SMOKE-20261023-1720.json)
- Successful run event log: [nsc-booking-smoke-NSC-SMOKE-20261023-1720.log](nsc-booking-smoke-NSC-SMOKE-20261023-1720.log)
- Aborted first attempt log: [nsc-booking-smoke-NSC-SMOKE-20261023-1718.log](nsc-booking-smoke-NSC-SMOKE-20261023-1718.log)
- Aborted first attempt metrics (if present): [nsc-k6-booking-smoke-results-NSC-SMOKE-20261023-1718.json](nsc-k6-booking-smoke-results-NSC-SMOKE-20261023-1718.json)
- Read-only package/item probe script: [nsc-k6-booking-smoke-diag.js](nsc-k6-booking-smoke-diag.js)
- Prior three-user 500 report (context only): [nsc-three-user-draft-500-developer-report-2026-10-05.md](nsc-three-user-draft-500-developer-report-2026-10-05.md)

All timestamps above are from the execution logs in Asia/Colombo (UTC+05:30). Credentials and response bodies are not retained in this report.
