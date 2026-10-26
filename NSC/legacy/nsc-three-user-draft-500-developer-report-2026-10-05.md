> Sanitized copy of a recovered original. Historical evidence links refer to files in the original source folder unless included in this package. See README.md and provenance.json.

# NSC UAT booking portal — repeatable draft-creation HTTP 500

**Prepared:** 5 October 2026  
**Purpose:** Provide the NSC development team with reproducible client-side evidence and request for server-side investigation.  
**Status:** Observed twice during separate three-user UAT write runs. Root cause is not known.

## Executive summary

The booking-journey test received HTTP 500 twice from the draft-creation request, `POST /bookingportal/api/bookings`, during three-user runs. In both cases the failing request was virtual user 1's second journey (`VU1-I2`), for the same zero-cost 30-minute slot on 3 November 2026, and occurred while VU3 was also starting its third draft. The request took 4.331 seconds on the first run and 3.411 seconds on the retry. The load script stopped immediately on each failure and did not retry the POST.

All booking-journey reads and pre-create checks completed successfully for the failing journeys: login, authenticated identity, space, package, item, availability, and calculated zero price. Three bookings were completed on the retry before it stopped; those bookings have since been cancelled and verified. The two-user five-minute run completed 40 zero-cost Enquiries without HTTP errors, but that does not establish a cause or capacity limit.

The evidence establishes a repeatable HTTP 500 under the tested three-user schedule. It does not identify the server component or exception responsible.

## Endpoint and journey

- **Environment:** NSC Play UAT customer booking portal, `https://nsc-play-booking-portal.azurewebsites.net/bookingportal/`
- **Failing request:** `POST https://nsc-play-booking-portal.azurewebsites.net/bookingportal/api/bookings`
- **Journey:** Create a temporary booking draft for asset 586 (space), package 113 (Ceremonies Test Package), item 2156 (Low Impact / Under 15 people), one attendee, 30-minute slot. The calculated and submitted total was AU$0.00; the resulting submitted status was Enquiry. No payment call is part of this flow.
- **Accounts:** Three separate dedicated UAT test identities were used (VU1, VU2, VU3). Credentials are intentionally not included in this report.
- **Safety behavior:** Each run had a hard booking cap, no retry on a write, and automatic stop on the first failed request/check.

## Failure observations

| Run | UTC time of logged 500 | Local time (UTC+05:30) | Failing booking name | Requested slot | Result |
|---|---|---|---|---|---|
| `NSC-WRITE-20261005-1715` | 2026-10-05 11:46:54Z | 17:16:54 | `NSC-WRITE-20261005-1715-VU1-I2` | 2026-11-03 11:30–12:00 | HTTP 500, 4,331 ms |
| `NSC-WRITE-20261005-1800` | 2026-10-05 13:02:23Z | 18:32:23 | `NSC-WRITE-20261005-1800-VU1-I2` | 2026-11-03 11:30–12:00 | HTTP 500, 3,411 ms |

At each failure, the logs show VU3 starting its third draft at approximately the same time:

- First run: `...-VU3-I3`, slot 2026-11-13 11:00–11:30; draft-attempt event logged at 17:16:49 local.
- Retry: `...-VU3-I3`, slot 2026-11-13 11:30–12:00; draft-attempt event logged at 18:32:19 local.

Those concurrent VU3 attempts have no returned booking IDs or completed response events in the client logs. On the retry, the run-marked booking lists for all three accounts contained only the three confirmed bookings below; direct reads of candidate IDs <HISTORICAL_BOOKING_ID> and <HISTORICAL_BOOKING_ID> returned 404 under the VU1 and VU3 sessions. No additional record was found for the interrupted attempts in that retry. The first run's interrupted attempts were not independently reconciled for possible orphan drafts.

## Run-level results

| Measure | First three-user run (`1715`) | Diagnostic retry (`1800`) |
|---|---:|---:|
| Duration until automatic stop | 113.351 s | 82.561 s |
| Maximum VUs reported by k6 | 3 | 3 |
| HTTP requests | 96 | 45 |
| HTTP 500 responses | 1 | 1 |
| Checks passed / failed | 217 / 1 | 101 / 1 |
| Overall request p95 | 1,761 ms | 2,750 ms |
| Maximum request duration | 4,331 ms | 3,411 ms |
| Completed zero-cost Enquiries | 8 | 3 |

The first run used a 60-booking ceiling and planned a five-minute three-user hold; it stopped before completing the hold. The diagnostic retry used a gradual ramp and a 12-booking hard ceiling (four per account); it also stopped before the hold completed. These are failed diagnostic runs, not completed load or capacity tests.

## Completed test records and cleanup

- First run completed references <BOOKING_REFERENCE>–<BOOKING_REFERENCE>; those records were subsequently cancelled and verified as `CANCELLED` at AU$0.00.
- Retry completed <BOOKING_REFERENCE>–<BOOKING_REFERENCE>; those records were cancelled through the customer cancellation API as their owning test accounts. Each cancellation returned HTTP 200 and was verified by a follow-up GET as `Cancelled`, total AU$0.00. No cancellation was retried.
- Cancellation emails were allowed by the user for this cleanup. The API has no notification-suppression flag, so actual email delivery was not independently confirmed.
- Retry cleanup record: [nsc-booking-cleanup-NSC-WRITE-20261005-1800.json](nsc-booking-cleanup-NSC-WRITE-20261005-1800.json).

## What the client evidence does and does not show

**Observed:** the same API operation returned HTTP 500 twice; both failures were on VU1's second journey; pre-create workflow checks succeeded; and the failed requests took multiple seconds. The retry's failed booking name and slot are explicitly recorded immediately before the request.

**Not captured:** response body/error payload, request/correlation/trace ID, server exception, database/dependency telemetry, and a full serialized request-body snapshot. Therefore no root cause can be asserted from these k6 logs alone. For the first run, the concurrent unreturned draft attempts were not independently checked for partial records.

## Requested investigation

Please correlate the two UTC time windows (at least ±1 minute around each timestamp) in App Service/Application Insights and the booking API's database/dependency logs. In particular:

1. Find the exception/stack trace and server-side operation for each `POST /bookings` corresponding to booking names `NSC-WRITE-20261005-1715-VU1-I2` and `NSC-WRITE-20261005-1800-VU1-I2`.
2. Compare each failed request with nearby successful draft-creation requests from VU1/VU3. Check whether the requests reached the same application instance and whether an upstream dependency, database transaction, validation rule, locking/availability operation, or timeout failed.
3. Confirm whether either HTTP 500 occurred after any booking/draft row or related allocation had been persisted. Search by both run IDs/booking names, including temporary records, and advise whether any cleanup is required.
4. Check whether the repeatable VU1-I2 / concurrent VU3-I3 timing is significant, or coincidental, and identify a safe reproduction profile after the cause is understood.
5. Share the relevant server-side correlation IDs, sanitized exception, root cause, and recommended fix/mitigation. No credentials or client PII are needed from this report.

## Evidence files

- First run metrics: [nsc-k6-booking-3vu-results-NSC-WRITE-20261005-1715.json](nsc-k6-booking-3vu-results-NSC-WRITE-20261005-1715.json)
- First run event log: [nsc-booking-3vu-sustained-write-NSC-WRITE-20261005-1715.log](nsc-booking-3vu-sustained-write-NSC-WRITE-20261005-1715.log)
- Retry metrics: [nsc-k6-booking-3vu-results-NSC-WRITE-20261005-1800.json](nsc-k6-booking-3vu-results-NSC-WRITE-20261005-1800.json)
- Retry event log: [nsc-booking-3vu-diagnostic-NSC-WRITE-20261005-1800.log](nsc-booking-3vu-diagnostic-NSC-WRITE-20261005-1800.log)
- Retry draft reconciliation: [nsc-k6-reconcile-3vu-aborted-drafts-NSC-WRITE-20261005-1800-probe02.log](nsc-k6-reconcile-3vu-aborted-drafts-NSC-WRITE-20261005-1800-probe02.log)
- Retry cleanup API log and metrics: [nsc-k6-cleanup-3vu-diagnostic-api-NSC-WRITE-20261005-1800.log](nsc-k6-cleanup-3vu-diagnostic-api-NSC-WRITE-20261005-1800.log), [nsc-k6-cleanup-3vu-diagnostic-api-results-NSC-WRITE-20261005-1800.json](nsc-k6-cleanup-3vu-diagnostic-api-results-NSC-WRITE-20261005-1800.json)

All timestamps above are from the execution logs; UTC is derived from the recorded Asia/Colombo time (UTC+05:30). The detailed response bodies were not retained.
