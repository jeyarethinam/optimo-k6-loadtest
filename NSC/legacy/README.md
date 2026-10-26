# NSC load test: recovered and sanitized originals

Recovered on 22 October 2026 from **NSC Load Test**, in **PenTests and LoadTests**.

Source task: codex://threads/01a0f1ee-5caf-7592-976a-8ff06dc16e0c

Source project directory: `C:\Users\nadit\OneDrive\Documents\NK\ChatGPT\PenTests`

These are separate sanitized copies of actual files found in the original task's directory. The supported task reader also showed their creation/update records and the matching 5 October test results. The disk files are the versions present at recovery time; this is not an assertion of a historical byte snapshot. SHA-256 hashes and exact source paths are in `provenance.json`. Every original file was left in place and its hash was rechecked after copying.

## What was recovered

| Original artifact | Historical role |
|---|---|
| `nsc-k6-booking-3vu-sustained-write.js` and matching `nsc-run-booking-3vu-sustained-write.ps1` | First three-user failure, run `NSC-WRITE-20261005-1715` |
| `nsc-k6-booking-3vu-diagnostic.js` and matching `nsc-run-booking-3vu-diagnostic.ps1` | Three-user diagnostic retry, run `NSC-WRITE-20261005-1800` |
| `nsc-k6-booking-2vu-sustained-write.js` and matching `nsc-run-booking-2vu-sustained-write.ps1` | Two-user comparison, run `NSC-WRITE-20261005-1740` |
| `nsc-booking-api-map.md` | Original API map, initially source-derived from saved portal bundles and subsequently updated; not a HAR recording |
| `nsc-three-user-draft-500-developer-report-2026-10-05.md` | Original failure investigation report |
| Three `nsc-k6-booking-*-results-*.json` files | Original aggregate metrics for those runs |

No existing Postman collection, JMeter `.jmx`, HAR, `.http`, or `.rest` file was found in the source project tree (383 files inspected by filename). No Postman collection was reconstructed. The actual recovered API workload is implemented in the k6 scripts, with the original endpoint map supplied alongside it. No 13 October security retest or 14 October accessibility artifact is included.

`README.md`, `environment.template.json`, and `provenance.json` are newly authored recovery documentation, not original test artifacts. The archive is new packaging of these files.

## Original request journey and session model

The scripts use k6's per-VU cookie jars and `noCookiesReset: true`. No saved cookies, bearer credentials, or session values are included. Each write journey logs in using its assigned account and password from process environment, then calls:

1. `POST /customers/login` with `email` and `password`.
2. `GET /customers/me` for the assigned identity and concession.
3. `GET /assets/586`.
4. `GET /products/private-packages?assetId=586`.
5. `GET /products/items?assetId=586&salesCategoryId={returned category IDs}`.
6. `GET /timeslots?assetIds=586&fromDate={date}&toDate={date}`.
7. `GET /products/items/2156/calculated-price` with start/end time, quantity 1, and the returned concession ID.
8. `POST /bookings` with the full temporary-draft payload preserved in the recovered script.
9. `PATCH /bookings/{returned bookingId}` with customer details and `isTemporary: false`, submitting the Enquiry.
10. `GET /bookings/{returned bookingId}?includes=bookingStatus,bookingPackages,bookingItems,Allocations,Timeslot` to verify the zero-cost Enquiry, status ID 53.

The API base path is `/bookingportal/api`. The scripts preserve the original dynamically derived price group, asset primary ID, product/category identifiers, customer values and returned booking identifiers. Runtime references to fields such as `me.phone` are schema logic; no actual personal values are embedded. The original map also documents the customer cancellation route. It does not establish a no-email cancellation option.

## Historical workload, not an instruction to execute

| Profile | Ramp / hold / ramp down | Pace and ceiling |
|---|---|---|
| Three-user sustained | 30 s at target 1, 30 s at 2, 30 s at 3, 5 min at 3, 30 s to 0 | 15 s target journey pacing; 20 iterations/account; 60 booking ceiling |
| Three-user diagnostic | Same three ramp stages, 2 min at 3, 30 s to 0 | 15 s pacing; 4 iterations/account; 12 booking ceiling |
| Two-user comparison | 30 s at target 1, 30 s at 2, 5 min at 2, 30 s to 0 | 15 s pacing; 20 iterations/account; 40 booking ceiling |

The original 30 s graceful ramp-down, initial per-user staggering and 0.25 s request pauses are retained. All use separate account slots and scan for an available 30-minute slot between 08:00 and 18:00. Three-user partitions begin 3, 8 and 13 November 2026; two-user partitions begin 3 and 10 November. These are historical fixture dates, not future scheduling advice. The same failed slot could be selected on another run if it remained available.

The workload uses asset 586, package 113 (Ceremonies Test Package), item 2156, one attendee and a verified zero total. It contains booking writes and no payment operation. Request/check failures abort immediately; write requests are not retried. The cap is implemented through per-VU iteration limits. The latency thresholds are end-of-run thresholds: the recovered files do not configure `abortOnFail` on those thresholds. Preserve this distinction when interpreting historical claims about automatic stopping.

Both three-user runs stopped at draft creation (`POST /bookings`), at 113.351 s and 82.561 s respectively. The HTTP 500 request durations were 4.331 s and 3.411 s. The failure was VU1's second journey, while VU3 was starting its third. The two-user comparison completed 40 Enquiries; this does not explain the failures or establish capacity. See the recovered report and original aggregate metrics. No full failing request-body snapshot, 500 response body, server exception or correlation ID was retained in the report.

## Sanitization and environment

Literal account emails were replaced with `test-user-N@example.invalid`. No plaintext password was present in the selected launchers: they prompted securely and temporarily set `NSC_TEST_PASSWORD`; that mechanism and environment variable references are retained. The actual endpoint origin in executable copies is replaced with `https://example.invalid`, historical run-confirmation values use `SANITIZED-...-RUN-ID` placeholders, and the machine's k6 path is replaced with `<K6_EXECUTABLE_PATH>`. Historical booking references and record IDs in the copied documentation are placeholders. Original historical run IDs remain in report text, metrics filenames and provenance to identify the evidence; these are evidence labels, not credentials.

`environment.template.json` lists placeholder inputs for review. It is documentation, not a k6 environment-import file. The original launchers populated account variables, matched the run-specific confirmation flag and cap, prompted for the password, invoked k6, and removed those process variables afterwards. Their copied target and executable-path placeholders require deliberate configuration. No replacement credentials, cookies, tokens, authentication secrets, names, phone numbers or personal test account data are supplied.

During recovery no workload was run, no NSC API was requested, no NSC login occurred, no one was contacted, and no file was uploaded or shared. All verification was local file inspection, hashing and sanitization checks. The source task was read through the supported app tools; restricted session storage was not accessed.