# Capturing Failed API Responses in K6 Load Tests

This document describes how failed requests are captured during the load test, where server-side errors appear in logs, and how to filter them.

---

## 1. How Failed Requests Are Captured (K6 Side)

- **When:** Every API request that returns a status other than 200, 201, or 204 is treated as a failure. The script logs one structured JSON line per failure to **stderr** (prefix: `K6_FAILED_REQUEST`).
- **What is logged:** Request time, URL, HTTP method, status code, response time (ms), booking ID, package ID, invoice ID (when available), endpoint name, request body (truncated), and response body (truncated).
- **No file write from K6:** K6 runs in a sandbox and cannot write to the filesystem. So we do not write a file from inside the test. Instead:
  1. You **save the run output** to a log file (e.g. `k6 run ... 2>&1 | tee k6-run.log`).
  2. After the run, you run **`node extract-failures.js k6-run.log`**, which parses the log and **overwrites** `failed-requests.json` and `failed-requests.csv` (i.e. they reset for every new run).

### Workflow

```powershell
# From ECOM/: run load test and save all output to k6-run.log (overwrites each time)
cd ECOM
k6 run --out json=metrics.json script.js -e TEST_MODE=peak 2>&1 | Tee-Object -FilePath k6-run.log

# From repo root: then generate failed-requests.json and failed-requests.csv next to that log
cd ..
node extract-failures.js ECOM/k6-run.log
```

Or with npm (runner writes `ECOM/k6-run.log` and runs extraction under `ECOM/`):

```powershell
npm run peak
```

### Output Files (Reset Each Run)

| File | Description |
|------|-------------|
| `failed-requests.json` | Full summary + array of failed request objects (requestTime, url, method, status, responseTimeMs, bookingId, packageId, invoiceId, endpoint, requestBody, responseBody). |
| `failed-requests.csv`  | Same data in CSV form for Excel or other tools. |

### Performance

- Only failed responses are logged (one line per failure).
- Request and response bodies are truncated (default 4000 chars) to avoid huge logs and extra work.
- No synchronous file I/O inside the test; only `console.error` is used. The extractor runs after the test.

---

## 2. Where API Failures Appear in Server Logs

Depending on your stack, failed API responses (4xx/5xx) are usually logged in these places:

### Node.js (Express, Fastify, etc.)

- **Application logs:** Wherever you log (e.g. `console`, Winston, Pino). Failed responses are often logged in error middleware or when you call `res.status(500).json(...)`.
- **Typical locations:** stdout/stderr of the process, or log files configured by your logger (e.g. `logs/error.log`).
- **What to look for:** Stack traces, `statusCode`, request URL/method, and any request/response bodies you log.

### .NET (ASP.NET Core, IIS)

- **Application:** Trace and log output from your app (e.g. Serilog, NLog, ILogger). Failed requests are often logged in exception middleware or action filters.
- **IIS:** Failed requests can be in:
  - **Failed Request Tracing:** If enabled, under the site’s `Trace` folder or the path configured in `web.config`.
  - **IIS logs:** Typically `C:\inetpub\logs\LogFiles\` or the path set in IIS (W3C format). These include status codes (e.g. 500, 502, 504) and URLs.
- **Event Log:** Windows Event Viewer → Application or Custom log your app writes to.
- **Kestrel / stdout:** If you run the app as a console (e.g. `dotnet run`), errors may go to stdout/stderr or to the sink you configured (e.g. file).

### Nginx

- **Access log:** Usually `/var/log/nginx/access.log` (path set by `access_log`). Each line typically includes: IP, time, method, URL, status code, response size, etc. Non-2xx status codes are the failed requests.
- **Error log:** `/var/log/nginx/error.log` (path set by `error_log`). Upstream timeouts (502, 504), connection errors, and other proxy/app failures are logged here.
- **Format:** Depends on `log_format`; often something like: `$status`, `$request`, `$request_uri`, `$upstream_status`, `$upstream_response_time`.

---

## 3. Filtering Server Logs for Failed API Responses

Once you know where your stack writes logs, you can filter by status code, URL, or by IDs (e.g. booking ID, package ID) that you got from `failed-requests.json` or `failed-requests.csv`.

### By status code (500, 502, 504, etc.)

**Linux / grep (access-style logs with status in the line):**

```bash
# Lines containing status 500
grep '" 500 ' /var/log/nginx/access.log
grep ' 500 ' /var/log/app/access.log

# 502 and 504
grep -E '" (502|504) ' /var/log/nginx/access.log

# Any 5xx
grep -E '" 5[0-9]{2} ' /var/log/nginx/access.log
```

**If your log format uses a different delimiter (e.g. JSON or tab):**

```bash
# JSON log with "status": 500
grep '"status":500' /var/log/app.json

# Or with jq
cat /var/log/app.json | jq 'select(.status >= 500)'
```

### By endpoint / URL

```bash
# Only /api/V4.1/bookings
grep '/api/V4.1/bookings' /var/log/nginx/access.log | grep -E ' (500|502|504) '

# Only payments
grep '/api/V4.1/payments' /var/log/app.log
```

### By booking ID or package ID

Use the IDs from `failed-requests.json` or `failed-requests.csv`:

```bash
# Booking ID 86671 (replace with ID from your failed-requests file)
grep '86671' /var/log/nginx/access.log
grep '86671' /var/log/app/error.log

# Package ID
grep '5201' /var/log/app.log
```

### Combined: failed status + booking ID

```bash
grep -E ' (500|502|504) ' /var/log/nginx/access.log | grep '86671'
```

---

## 4. Example Log Filtering Cheat Sheet

| Goal | Example (Linux) |
|------|------------------|
| All 500 errors | `grep '" 500 ' access.log` |
| All 502/504 | `grep -E '" (502|504) ' access.log` |
| All 5xx | `grep -E '" 5[0-9]{2} ' access.log` |
| Specific URL | `grep '/api/V4.1/payments' access.log` |
| Failed + URL | `grep -E ' (500|502|504) ' access.log \| grep '/api/V4.1/'` |
| By booking ID | `grep 'BOOKING_ID' access.log` or `grep '86671' app.log` |
| By time window | `grep '09/Mar/2026:12:41' access.log` |
| Count failures | `grep -c '" 500 ' access.log` |

Adjust the exact pattern (e.g. `" 500 ` vs ` 500 `) to match your log format.

---

## 5. Best Practices

- **Always tee the k6 output** so you have a log to run `extract-failures.js` on.
- **Run the extractor after each test** so `failed-requests.json` and `failed-requests.csv` match the last run (they are overwritten).
- **Correlate with server time:** Use `requestTime` from the JSON/CSV and your server’s time zone to find the same moment in app/nginx logs.
- **Keep request/response body truncation** (e.g. 4000 chars) to avoid log bloat and minimal impact on load test performance.
- **On the server:** Use structured logging (e.g. JSON with `status`, `url`, `bookingId`, `requestId`) so you can grep or use jq to filter by status, endpoint, or ID.
