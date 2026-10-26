> Sanitized copy of a recovered original. Historical evidence links refer to files in the original source folder unless included in this package. See README.md and provenance.json.

# NSC UAT booking API map

Prepared 1 October 2026 from saved portal application bundles. This is source-derived evidence, not a browser network recording. Current write payloads must be verified before replay.

Base: `https://nsc-play-booking-portal.azurewebsites.net/bookingportal/api`

| Step | Method and path | Evidence |
|---|---|---|
| Login | POST /customers/login, JSON email/password | uat-core.js; session 6 core bundle |
| Session identity | GET /customers/me | Existing UAT assessment harness |
| Selected space | GET /assets/586 | Asset service; verified UI space |
| Availability | GET /timeslots with assetIds, fromDate, toDate | Current booking page imports dedicated TimeslotService from chunk-236Z23W7.js |
| Configurations | GET /products/private-packages?assetId=586 | Existing assessment harness |
| Temporary booking | POST /bookings | Booking service; summary component sets isTemporary=true |
| Continue existing draft | PATCH /bookings/{returned bookingId} | Summary component |
| Final customer details and state | PATCH /bookings/{returned bookingId} | Confirmation component: customer, isTemporary, agreedToTerms, bookingStatus, smsUpdates |
| Confirmation retrieval | GET /bookings/{returned bookingId} | Core booking service |

Cart state is maintained in the application. No independent cart API has been established.

## Cancellation API discovery — 5 October 2026

Inspection of the saved NSC customer-portal bundle (`uat-session2-core.js`, cross-checked against the 30 September public bundle) found a customer self-service cancellation flow:

1. `POST /bookings/{bookingId}/notes` with a booking note (`entityTypeId: 10`, `entityType: "Booking"`, `noteTypeId: 17`, `requestStatus: 1`, `plainText: "Cancellation reason: <user text>"`).
2. On successful note creation, `POST /bookings/{bookingId}/cancel-booking` with `{ id, cancelled: true, cancelledDate, cancellationFee, cancellationReasonId: 2, note: "Customer has cancelled it!" }`.

This was initially source-derived evidence for the customer-facing portal, not a recorded request from the authenticated Booking Manager UI. A bounded one-booking live validation subsequently exercised this customer-portal flow: run `NSC-CANCEL-API-20261005-01` created zero-cost Enquiry <BOOKING_REFERENCE> (bookingId <HISTORICAL_BOOKING_ID>), posted the reason note, and called the cancellation route once with reason ID 2 and fee 0. The cancel POST returned HTTP 200/success; the subsequent GET returned status `Cancelled`, `cancelled: true`, and totalAmount 0. Booking Manager independently displayed <BOOKING_REFERENCE> as `CANCELLED`, AU$0.00, and showed the run-labelled note. Performance evidence: `nsc-k6-cancel-api-events-NSC-CANCEL-API-20261005-01.log`, `nsc-k6-cancel-api-results-NSC-CANCEL-API-20261005-01.json`; cleanup/verification evidence: `nsc-booking-cleanup-NSC-CANCEL-API-20261005-01.json`.

This validates that the customer-portal endpoint can cancel this zero-cost UAT enquiry and that the state is reflected in Booking Manager. It does **not** capture the staff Booking Manager's own request, prove equivalence of all staff-side rules, or establish email behavior. The customer endpoint has no notification flag; an automatic email may have been sent, but delivery was not independently verified. Do not represent this endpoint as “no-email” cleanup. For future cleanup where notifications must be suppressed, continue using the Booking Manager UI unless a supported API flag is confirmed. The one-booking API test ran with the user's explicit approval of the possible notification.

Remaining verification for exact staff-flow equivalence: capture a fresh network trace of the Booking Manager cancellation and compare route, reason mapping, fee, notification setting, note behavior, and response. Never retry a cancellation POST after an uncertain response without first retrieving the booking state. Credentials/session tokens must be supplied transiently, not saved in scripts or evidence.

The summary step can create a temporary server booking before the final confirmation screen. Never retry a booking POST after an uncertain result without reconciliation. Use the returned bookingId; do not infer it from the displayed reference.

Known manual fixture: <BOOKING_REFERENCE>, created 30 September, pending review, free. It did not exercise payment. Cleanup remains outstanding.

The new k6 discovery script is deliberately limited to one user, one iteration, login plus four reads, with a one-second pause between requests. It stores aggregate metrics without credentials or response bodies. It validates cookies/session continuity and read endpoints; it is not a booking creation load test.

Remaining write preparation: verify the current payload builder, correlate package/item/configuration identifiers, assign unique future slots, bound total created bookings, track every returned identifier, and verify final status plus cleanup. Paid sandbox flow remains unvalidated.

## Live discovery result, 1 October 2026

The dedicated account signs in successfully in the in-app browser. Its available automation capabilities do not include network/HAR recording.

Two sequential one-user k6 discovery runs reached the API. In each, login, authenticated identity, and asset 586 passed with HTTP 200 and expected application data. Availability returned HTTP 400; subsequent requests were skipped by design. The initial sandbox-denied attempt sent no successful request.

A single additional read-only availability request returned `error.message: name is not a valid field`. The date-only format was checked against the saved calendar component, but changing from timestamps to dates did not resolve the failure. Root cause is unconfirmed; this could involve current endpoint behavior or its upstream service. No performance or capacity conclusion is justified from these checks.

Correction after tracing the current deployed code: main-WSZHGFV5.js loads booking page chunk-YWXDID54.js. Its timeslotService uses alias si imported from chunk-236Z23W7.js. That dedicated service calls GET /timeslots, not the /assets/timeslots helper found in the core asset service. The original test used the wrong endpoint for the booking flow; its HTTP 400 must not be reported as a portal availability failure. Script corrected accordingly.

Corrected live rerun at approximately 10:16 Asia/Colombo passed (k6 exit 0): 1 user, 1 iteration, 5 HTTP 200 responses, all checks passed. Login 1246 ms; identity 350 ms; space 349 ms; availability 561 ms; configurations 349 ms. These individual measurements are connectivity/functional evidence, not capacity benchmarks. Aggregate output: nsc-k6-booking-discovery-results.json. The earlier availability and configuration verification limitations are resolved by this rerun. Booking writes and payment remain outside this script.

No new booking was created during the 1 October discovery preparation. No concurrent load or paid sandbox transaction ran. The corrected discovery run verified the configurations endpoint.

## Single booking execution, 2 October 2026

Revalidated against deployment main-VINA5XZK.js, booking component chunk-6XPN2U2N.js, product service chunk-W4VJBVGV.js, summary chunk-HFRMDRPF.js, confirm-details chunk-BC4IAG6V.js, item serializer chunk-LU2GAUM7.js, and core chunk-G265Q5EL.js.

Package 113 (Ceremonies Test Package), item 2156 (Low Impact/Under 15 people), asset 586. One attendee; 9 October 2026 17:00–17:30, portal local wall time. Price API returned zero with the authenticated customer's concession. Browser preview independently showed the same slot, free price, and Needs Approval. The browser-only cart preview was removed without submitting it.

Run NSC-K6-SMOKE-20261002-01 created exactly one booking: returned bookingId <HISTORICAL_BOOKING_ID>, reference <BOOKING_REFERENCE>. Temporary POST, final PATCH with isTemporary=false and bookingStatus=pending, and confirmation GET all returned HTTP 200. Ten total requests, 21 checks passed, zero HTTP failures, 18.49 seconds including pacing. Create 1650 ms; submit 1854 ms; retrieve 631 ms. No automatic write retry.

Important: confirmation returned bookingStatus {id:53, name:Enquiry, stockAllocated:true, parentBookingStatusID:2}, totalAmount 0. The initial script asserted successful retrieval but did NOT assert the final business status. Therefore exit 0 alone is not full business-flow acceptance; reconcile the API status with the portal presentation before any concurrent writes. Do not call this a confirmed booking or a capacity result.

Artifacts: nsc-k6-booking-smoke.js, nsc-run-booking-smoke.ps1, nsc-k6-booking-smoke-events.log, nsc-k6-booking-smoke-results.json. The runner refuses replay when the evidence log already exists. Credentials are prompted and removed from process environment afterward. Cleanup for <BOOKING_REFERENCE> and <BOOKING_REFERENCE> is outstanding; no cancellation or deletion performed. Payment and concurrent traffic remain untested.

Business-status reconciliation completed in the refreshed, signed-in browser: My Account > Upcoming shows NSC-K6-SMOKE-20261002-01, <BOOKING_REFERENCE>, 9 Oct 2026 17:00, 30m, Ceremonies Test Package, Enquiry, Free. My Account > Past shows the earlier manual fixture <BOOKING_REFERENCE> as Enquiry and Free too. Thus the persisted status agrees with the manual baseline; the historical Pending Review wording must not be interpreted as an expected literal backend status. No confirmed approval is claimed.

After this comparison, the script gained explicit assertions for matching booking ID/reference, zero persisted total, and verified Enquiry status (53). Syntax was inspected, but the updated assertions were not executed against a newly created booking. Original metrics still represent the initial 21-check run; independent browser verification supplies the business-outcome evidence. The single-user booking smoke gate passed with this combined evidence. Before a ramp: prepare isolated sessions/accounts or explicitly label a shared-account test, allocate non-overlapping slots, cap total booking writes, verify cancellation/cleanup, and configure abort thresholds. The 50-VU ceiling is not a target to run immediately.

## Read-only ramp, 2 October 2026

Two, five, ten, and twenty-five VU one-iteration waves passed. All requests were reads except login; no booking changes occurred. Each VU had an independent k6 cookie jar, but all authenticated as the same account. At 25 VUs, overall request p95 was 2.12s; login p95 was 2.20s. Other endpoints had p95 below 0.76s. All 350 checks passed and there were no failed HTTP requests. Given the short ~10s burst and rising login time, pause before 50 and investigate/measure a paced sustained profile. These runs are functional concurrency snapshots, not capacity measurements.

Per-run event log comparison: login p95 was 1.242s (2 VUs), 0.738s (5), 0.912s (10), and 2.198s (25); at 25 VUs the slowest non-login endpoint was 759ms. A warm-session 25-VU read-only hold would isolate authentication startup from ongoing booking lookups before another ramp.

Warm-session diagnostic: during the planned 25-VU ramp/hold, two VUs logged in successfully (HTTP 200), then the first VU's next `/customers/me` returned 401 immediately after the second login. The script aborted at that check after 11 total requests. This strongly suggests a single-account session limit or invalidation behavior. Do not model sustained concurrent users with this shared account. Provision distinct UAT test identities (or use an approved multi-session test account configuration) and validate two independent sessions before continuing. No 50-VU run or additional booking writes were made.
