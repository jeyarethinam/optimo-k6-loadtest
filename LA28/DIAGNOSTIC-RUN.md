# LA28 diagnostic runs — lock timeout / ~165s investigation

Use diagnostic mode when investigating SQL lock timeouts (`SqlLockTimeoutMs=15000`, SQL error 1222 → HTTP 408) and stacked ~11×15s request durations on write endpoints.

## 1. Normal run (unchanged behavior)

```bash
node LA28/run-load-test.js peak300
# or
npm run peak300
```

- `DIAGNOSTIC_MODE` is off (default).
- No extra console noise or slow-request log extraction.
- Artifacts are still copied to `LA28/archive/` with a timestamped `RUN_ID`.

## 2. Diagnostic run

```bash
node LA28/run-load-test.js peak300 --diagnostic
```

Or:

```bash
DIAGNOSTIC_MODE=1 node LA28/run-load-test.js peak300
```

Optional:

```bash
# Also echo slow/failed lines to console (warn level)
WRITE_DIAGNOSTIC_CONSOLE=1 node LA28/run-load-test.js peak300 --diagnostic

# Informational threshold on http_status_408 (never fails the run)
DIAGNOSTIC_THRESHOLDS=1 node LA28/run-load-test.js peak300 --diagnostic
```

Diagnostic mode adds:

- Per-request `http_status` counters (408, 429, 500+, all status codes) — recorded on every run; visible in HTML report.
- `slow_request_ms` trend for responses ≥ 60s.
- `K6_DIAGNOSTIC_SLOW` log lines for slow (≥60s) or failed requests → extracted to `LA28/diagnostic-slow-requests.jsonl` after the run.
- **HTTP Status Breakdown** section in `report.html` and `diagnostic-summary.json`.

## 3. Files to zip and share after a diagnostic peak300 run

From `LA28/archive/` (paths printed at end of run):

| File | What it proves |
|------|----------------|
| `metrics_{RUN_ID}.json` | Raw per-request time series; correlate latency spikes with VU ramp |
| `summary_{RUN_ID}.json` | Full k6 summary including `http_status_*` and `slow_request_ms` |
| `diagnostic-summary_{RUN_ID}.json` | Parsed status breakdown, 408 count, slow request count, lock-timeout hypothesis note |
| `slow_{RUN_ID}.jsonl` | One JSON object per slow (≥60s) or failed request: `flow_step`, `status`, `duration_ms`, `vu` |
| `k6-run_{RUN_ID}.log` | Full console log; search for `K6_FAILED_REQUEST`, `ERROR_REPORT`, `408` |
| `report_{RUN_ID}.html` | Stakeholder report with HTTP Status Breakdown + existing endpoint table |

Also useful: timestamped HTML from `add-graphs` (e.g. `report_YYYYMMDD_HHMMSS_peak300_300VU_630s.html`).

## 4. Interpreting results for ~165s root cause

| Signal | Interpretation |
|--------|----------------|
| `http_status_408` > 0 | Direct proof of API lock-timeout responses |
| Write-step P99 ≈ 15–16.5s | Single 15s lock wait per request (typical under contention) |
| `slow_request_ms` max ≈ 165000 ms | ~11×15s stacked lock waits in one HTTP request |
| `slow_*.jsonl` with `status: 408` and `duration_ms` ~150000–165000 | Per-request proof linking step name to lock timeout |
| GET steps max &lt; 10s, writes max ~165s | Contention isolated to booking write paths |

## 5. Environment variables

| Variable | Default | Effect |
|----------|---------|--------|
| `DIAGNOSTIC_MODE` | `0` | `1` = extract slow/failed request jsonl from log |
| `LOG_SLOW_REQUESTS` | `0` | Same as diagnostic slow logging (either enables it) |
| `WRITE_DIAGNOSTIC_CONSOLE` | `0` | `1` = `console.warn` for each diagnostic slow line |
| `DIAGNOSTIC_THRESHOLDS` | `0` | `1` = add informational `http_status_408` threshold |
| `DIAGNOSTIC_SLOW_MS` | `60000` | Threshold for “slow” classification |
| `RUN_ID` | auto timestamp | Override archive file suffix |
