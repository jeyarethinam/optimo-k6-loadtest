# Fixing Load Test Errors

This guide covers how to fix the errors you see during peak load (timeouts, 504, 500, 502, 401, 400).

---

## 1. Connection timeouts (Status 0, response null)

**Symptom:** `read tcp ... connected party did not properly respond`, Status 0, Response null.

### Script side
- **Retries:** The script can retry transient failures (see "Retries" below). Already added for Create Booking and Login.
- **Softer ramp:** In `load-profile.js`, use a longer ramp (e.g. 3m to reach 100 VUs) so the server is not hit all at once.
- **Lower peak VUs:** Try a lower target (e.g. 50) to find the point where timeouts start.

### Server / infrastructure
- **Scale out:** Add more app instances so the server can handle more concurrent connections.
- **Timeouts:** Increase gateway/load balancer timeouts so slow responses are not cut off (and fix slow endpoints).
- **Connection limits:** Raise max connections per instance and at the load balancer.
- **Network:** Check for drops or limits between client and server (firewalls, proxies).

---

## 2. 504 Gateway Timeout

**Symptom:** Status 504, "504.0 GatewayTimeout".

### Script side
- **Retries:** Retry once after a short sleep so a single slow response does not count as a hard failure.
- **Ramp:** Longer ramp-up to avoid a sudden spike that overwhelms the backend.

### Server / infrastructure
- **Backend performance:** Find and fix slow endpoints (DB queries, N+1, missing indexes, heavy logic).
- **Gateway timeout:** Increase the gateway/proxy timeout (e.g. 60s → 120s) only if the backend is legitimately slow and you are fixing that too.
- **Scale:** Add capacity (CPU, memory, instances) so requests are answered within the gateway timeout.

---

## 3. 500 Internal Server Error

**Symptom:** Status 500, "An unexpected error occurred".

### Script side
- **Retries:** Use retries for idempotent or safe-to-retry calls (e.g. Create Booking, Login) to absorb transient 500s.
- **Logs:** Extract error booking IDs and correlate with server logs (see `extract-error-bookings.js`).

### Server / infrastructure
- **Logs:** Check application and server logs for the timestamp and request (e.g. booking ID) to see stack traces and cause.
- **Dependencies:** Check DB, cache, and external APIs for timeouts or errors under load.
- **Stability:** Fix bugs, add error handling, and add circuit breakers/fallbacks for external calls.
- **Resources:** Check CPU, memory, and connection pools under load; scale or tune as needed.

---

## 4. 502 Bad Gateway

**Symptom:** HTML response "502 - Web server received an invalid response".

### Server / infrastructure
- **App health:** Ensure the app does not crash or close connections abruptly under load.
- **Gateway config:** Check proxy/gateway logs to see why upstream response was invalid (timeout, connection reset, bad response).
- **Scaling:** Add or scale app instances so the gateway always has a healthy upstream.

---

## 5. 401 Unauthorized (token expired)

**Symptom:** "Unauthorised - You need to log in; potentially the token may have expired."

### Why it happens
- The **server** assigns each login token a lifetime (TTL), e.g. 5 or 15 minutes. After that, the token is invalid and the API returns 401.
- The script logs in **once per iteration** at the start. Under load, a single iteration can take a long time (slow responses, timeouts). If one iteration runs longer than the token TTL, **later requests in that same iteration** use an expired token → 401.
- So 401 in load tests is usually: **token TTL too short** for the duration of one iteration under load.

### Script side (already supported)
- **Token refresh on 401:** With `ENABLE_TOKEN_REFRESH_ON_401 = true` (default), when any request returns 401 the script re-logins, gets a new token, and **retries the whole iteration** from the start. So the run can continue even if the server uses a short TTL.
- Set `ENABLE_TOKEN_REFRESH_ON_401 = false` in `script.js` if you prefer to fail on 401 (e.g. to measure token expiry).

### Server / infrastructure
- **Token TTL:** Increase auth token lifetime (e.g. 30–60 minutes) so it covers long iterations during load tests. The script can still refresh on 401, but a longer TTL reduces unnecessary re-logins.
- **Auth performance:** Ensure login and token validation scale so auth is not the bottleneck.

---

## 6. 400 Bad Request (flow / state)

**Symptom:** e.g. "Client can not be removed on Provisional booking status", "All the invoices have been created."

### Script side
- **Accept as expected:** These often happen when an earlier step failed (e.g. Add Client failed, then Confirm is called on a booking still "Provisional"). The script correctly reports them; no change needed unless you want to skip later steps when a previous step fails.
- **Idempotency:** For steps that must not run twice (e.g. invoice create), the API correctly returns 400; the script should not retry those unless the API supports idempotency keys.

### Server / infrastructure
- **Business rules:** No change needed if the API is enforcing correct rules. Improve error messages if needed for debugging.

---

## Retries (script)

The script can retry **Create Booking** and **Login** on transient failures (5xx, timeouts). This reduces failure rate when the server is temporarily overloaded.

- **Create Booking:** Up to 3 attempts (2 retries) with 1s and 2s delay.
- **Login:** Up to 3 attempts (2 retries) with 1s delay.

To disable retries, set in `script.js`:

```js
const ENABLE_RETRIES = false;
```

To add retries to more steps, wrap the call in `retry()` in `helpers.js` and use it in the script (only for steps that are safe to retry).

---

## Quick checklist

| Issue        | Script side              | Server / infra                    |
|-------------|--------------------------|-----------------------------------|
| Timeouts (0) | Retries, longer ramp     | Scale, timeouts, connections      |
| 504         | Retries, longer ramp     | Fix slow endpoints, scale        |
| 500         | Retries, use error IDs   | Logs, fix bugs, scale            |
| 502         | —                        | App stability, gateway, scale     |
| 401         | Shorter iterations, TTL  | Token TTL, auth scaling          |
| 400         | Optional skip on failure | Correct behaviour; improve msgs  |

---

## Finding failed requests (booking ID, package ID, invoice ID, etc.)

When a request fails, the script logs a structured line (`ERROR_REPORT`) with endpoint, status, and any IDs available at that step (e.g. `bookingId`, `packageId`, `invoiceId`, `contactId`, `templateId`, `emailId`, `paymentTermDetailId`). After the run, extract these into report files:

1. **Save the run output to a log file:**

   ```powershell
   npm run peak 2>&1 | Tee-Object -FilePath k6-run.log
   ```

   Or with a custom log name:

   ```powershell
   k6 run --out json=metrics.json script.js -e TEST_MODE=peak 2>&1 | Tee-Object -FilePath my-run.log
   ```

2. **Generate the error report** (reads the log and writes `error-report.json` / `error-report.txt` **next to that log**, e.g. under `LA28/` or `wcc/`):

   ```powershell
   node extract-error-bookings.js LA28/k6-run.log
   ```

   Or use the npm shortcuts (LA28 default: `LA28/k6-run.log`, WCC: `wcc/k6-run.log`):

   ```powershell
   npm run extract-errors
   npm run extract-errors:wcc
   ```

3. **Open the report files** (in the same folder as the log you passed):

   - **`error-report.json`** – Full list of failures with all IDs, plus summary (booking IDs, package IDs, invoice IDs, count by endpoint).
   - **`error-report.txt`** – Human-readable summary and one line per failure with endpoint and IDs.

Use these IDs (e.g. bookingId, invoiceId) to find the same requests in server logs and debug the failure.
