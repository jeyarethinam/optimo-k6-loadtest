import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";
import exec from "k6/execution";
import encoding from "k6/encoding";

/** Request timeout – set very high so we capture actual response times (k6 has no "no timeout" option). 1 hour = effectively no limit for load tests. */
export const REQUEST_TIMEOUT = "3600s";

/**
 * Retry a function on failure (for transient 5xx, timeouts). Use only for safe-to-retry calls (e.g. Login, Create Booking).
 */
export function retry(fn, options = {}) {
  const { attempts = 3, delayMs = 1000 } = options;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) sleep((delayMs / 1000) * (i + 1));
    }
  }
  throw lastErr;
}

export function getHeaders(token) {
    return {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "token": token
        },
        timeout: REQUEST_TIMEOUT
    };
}

/** Throw this so the script can catch and re-login (token refresh on 401). */
export const UNAUTHORIZED_MSG = "UNAUTHORIZED";

/** Max length for request/response body in logs. 0 = no truncation (full response body). */
const FAILED_REQUEST_BODY_MAX_LEN = Number(__ENV.LOG_BODY_MAX_LEN || "0");
const LOG_ALL_RESPONSES = String(__ENV.LOG_ALL_RESPONSES || "false").toLowerCase() === "true";

function truncateBody(value, maxLen = FAILED_REQUEST_BODY_MAX_LEN) {
  if (value == null) return "";
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (!Number.isFinite(maxLen) || maxLen <= 0) return str;
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

// Endpoint-level custom metrics used for stakeholder-friendly report tables/charts.
// Counters must not use the time/isTime flag — that marks them as time metrics and can break end-of-test `count` aggregation for failures vs requests.
export const endpointDuration = new Trend("endpoint_duration", true);
export const endpointRequests = new Counter("endpoint_requests");
export const endpointFailures = new Counter("endpoint_failures");

/**
 * Log a single structured line for post-run error report extraction.
 * Include endpoint, status, and any IDs (bookingId, packageId, invoiceId, etc.).
 */
export function logErrorReport(attrs) {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => k + "=" + v);
  if (parts.length) console.error("ERROR_REPORT " + parts.join(" "));
}

/**
 * Log full failed request details for JSON/CSV export (parse from run log with extract-failures.js).
 * One line per failure: base64(JSON) after prefix so k6 log msg="..." escaping does not break nested JSON.
 */
export function logFailedRequest(details) {
  const body = (s) => {
    if (s == null) return "";
    const str = typeof s === "string" ? s : JSON.stringify(s);
    if (!Number.isFinite(FAILED_REQUEST_BODY_MAX_LEN) || FAILED_REQUEST_BODY_MAX_LEN <= 0) return str;
    return str.length > FAILED_REQUEST_BODY_MAX_LEN ? str.slice(0, FAILED_REQUEST_BODY_MAX_LEN) + "..." : str;
  };
  const out = {
    requestTime: details.requestTime || new Date().toISOString(),
    url: details.url ?? "",
    method: details.method ?? "",
    status: details.status ?? "",
    responseTimeMs: details.responseTimeMs ?? null,
    flowStep: details.flowStep ?? "",
    networkError: details.networkError ?? "",
    networkErrorCode: details.networkErrorCode ?? "",
    bookingId: details.bookingId ?? null,
    packageId: details.packageId ?? null,
    invoiceId: details.invoiceId ?? null,
    endpoint: details.endpoint ?? "",
    requestBody: details.requestBody != null ? body(details.requestBody) : "",
    responseBody: details.responseBody != null ? body(details.responseBody) : "",
  };
  console.error("K6_FAILED_REQUEST " + encoding.b64encode(JSON.stringify(out)));
}

/**
 * Log every API response (success + failure) to k6-run.log.
 */
export function logApiResponse(details) {
  const out = {
    requestTime: details.requestTime || new Date().toISOString(),
    endpoint: details.endpoint ?? "",
    flowStep: details.flowStep ?? "",
    method: details.method ?? "",
    url: details.url ?? "",
    status: details.status ?? "",
    responseTimeMs: details.responseTimeMs ?? null,
    bookingId: details.bookingId ?? null,
    packageId: details.packageId ?? null,
    invoiceId: details.invoiceId ?? null,
    clientId: details.clientId ?? null,
    contactId: details.contactId ?? null,
    templateId: details.templateId ?? null,
    emailId: details.emailId ?? null,
    paymentTermDetailId: details.paymentTermDetailId ?? null,
    requestBody: details.requestBody ?? "",
    responseBody: details.responseBody ?? "",
    networkError: details.networkError ?? "",
    networkErrorCode: details.networkErrorCode ?? "",
  };
  console.log("K6_API_RESPONSE " + JSON.stringify(out));
}

export function validate(res, name, context, options) {
    const req = res && res.request;
    const method = (req && req.method) ? req.method : "";
    const responseTimeMs = (res && res.timings && res.timings.duration != null) ? Math.round(res.timings.duration) : null;
    const flowStep = exec?.vu?.tags?.flow_step || "UNMAPPED_STEP";
    const metricTags = { endpoint: name, method, flow_step: flowStep };
    const contextData = (context && typeof context === "object") ? context : {};
    const url = (req && req.url) ? req.url : "";
    const responseBody = res && res.body != null ? truncateBody(res.body) : "";
    const requestBody = (options && options.requestBody) != null ? truncateBody(options.requestBody) : "";
    endpointRequests.add(1, metricTags);
    if (responseTimeMs != null) {
        endpointDuration.add(responseTimeMs, metricTags);
    }
    if (LOG_ALL_RESPONSES) {
        logApiResponse({
            requestTime: new Date().toISOString(),
            endpoint: name,
            flowStep,
            method,
            url,
            status: res ? res.status : "",
            responseTimeMs,
            ...(contextData || {}),
            requestBody,
            responseBody,
            networkError: res ? (res.error || "") : "NO_RESPONSE",
            networkErrorCode: res ? (res.error_code || "") : "",
        });
    }

    const ok = check(res, {
        [`${name} status ok`]: (r) => !!r && r.status >= 200 && r.status < 300
    });

    if (!ok) {
        endpointFailures.add(1, metricTags);

        console.error(`${name} FAILED`);
        console.error("Status:", res ? res.status : "NO_RESPONSE");
        console.error("URL:", url);
        console.error("Failure Context:", JSON.stringify(contextData));
        console.error("Response:", responseBody || "[empty]");
        if (requestBody) {
            console.error("Request Body:", requestBody);
        }
        if (res && (res.error || res.error_code)) {
            console.error("NetworkError:", res.error || "", "ErrorCode:", res.error_code || "");
        }
        if (context && typeof context === "object") {
            logErrorReport({ endpoint: name, status: res ? res.status : "", ...context });
        }
        logFailedRequest({
            requestTime: new Date().toISOString(),
            url,
            method,
            status: res ? res.status : "",
            responseTimeMs,
            flowStep,
            networkError: res ? (res.error || "") : "NO_RESPONSE",
            networkErrorCode: res ? (res.error_code || "") : "",
            endpoint: name,
            ...(context && typeof context === "object" ? context : {}),
            requestBody,
            responseBody,
        });
        if (res && res.status === 401 && name !== "Login") {
            throw new Error(UNAUTHORIZED_MSG);
        }
        if (options && options.continueOnFailure) {
            return;
        }
        const idParts = [];
        if (contextData.bookingId) idParts.push(`bookingId=${contextData.bookingId}`);
        if (contextData.contactId) idParts.push(`contactId=${contextData.contactId}`);
        if (contextData.packageId) idParts.push(`packageId=${contextData.packageId}`);
        if (contextData.invoiceId) idParts.push(`invoiceId=${contextData.invoiceId}`);
        const idSuffix = idParts.length ? ` (${idParts.join(", ")})` : "";
        const err = new Error(`${name} request failed with status ${res ? res.status : "NO_RESPONSE"}${idSuffix}`);
        err.k6Failure = {
            endpoint: name,
            flowStep,
            url,
            method,
            status: res ? res.status : "",
            responseTimeMs,
            networkError: res ? (res.error || "") : "NO_RESPONSE",
            networkErrorCode: res ? (res.error_code || "") : "",
            ...contextData,
            requestBody,
            responseBody,
        };
        throw err;
    }
}