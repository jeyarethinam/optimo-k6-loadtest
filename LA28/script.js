import { group, sleep } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import { login } from "./endpoints/auth.js";
import {
  createBooking,
  bookingSelect,
  packageSelect,
  addPackage,
  getCustomer,
  addClient,
  confirmBooking,
  emailTemplate,
  generateEmail,
  sendEmail,
  invoiceCreate,
  bookingInvoices,
  getInvoiceById,
  searchContactByEmail,
  searchBookingByEmail,
  findPriorityAccessBooking,
  updateBookingIsPaUserDefinedFieldValue,
  getBookingFullDetails,
  getBookingItems,
  getContactWithInvoiceAddress,
  updateClient,
} from "./endpoints/booking.js";
import { createPayment, paymentSelect, paymentCreditCardTypes } from "./endpoints/payment.js";
import { clientCategory, clientType, clientTitle, communicationTypes, country, createClient } from "./endpoints/customers.js";
import { loadProfile } from "./load-profile.js";
import { retry, UNAUTHORIZED_MSG, logErrorReport, logFailedRequest } from "../shared/helpers.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

const mode = __ENV.TEST_MODE || "smoke";
/** Set to "1" to log in inside each VU (old behavior). Default: one login in setup(), token shared by all VUs. */
const PER_VU_LOGIN = __ENV.PER_VU_LOGIN === "1";
const environmentName = __ENV.ENV_NAME || __ENV.ENV || "N/A";
const RUN_STARTED_AT = new Date();
const ENABLE_RETRIES = true;
const ENABLE_TOKEN_REFRESH_ON_401 = true;
const MAX_401_RETRIES = 3;
const THINK_TIME_MIN_S = Number(__ENV.THINK_TIME_MIN_S || "0.2");
const THINK_TIME_MAX_S = Number(__ENV.THINK_TIME_MAX_S || "1.0");
const P95_LIMIT_MS = Number(__ENV.P95_LIMIT_MS || "2000");
const P99_LIMIT_MS = Number(__ENV.P99_LIMIT_MS || "4000");
const endpointOrder = [
  "Login", "Client Category", "Client Type", "Client Title", "Communication Types", "Country", "Create Client",
  "Get Contact", "Search Contact By Email", "Find Priority Access Booking", "Create Booking", "Update Booking IsPA",
  "Search Booking By Email", "Package Select", "Add Package", "Booking Select", "Get Booking Full Details",
  "Get Contact With Invoice Address", "Update Client", "Get Booking Items", "Add Client", "Invoice Create",
  "Payment Select", "Payment Credit Card Types", "Booking Invoices", "Create Payment", "Confirm Booking",
  "Email Template", "Generate Email", "Send Email", "Get Invoice By ID", "LoginRefresh", "GetBookingFullDetailsForInvoiceFallback"
];
const flowStepOrder = [
  "Login", "ClientCategory", "ClientType", "ClientTitle", "CommunicationTypes", "Country", "CreateClient", "GetContact",
  "SearchContactByEmail", "FindPriorityAccessBooking", "CreateBooking", "UpdateBookingIsPA", "SearchBookingByEmail",
  "PackageSelect1", "PackageSelect2", "AddPackage", "BookingSelectA", "GetBookingFullDetails1", "PackageSelect3",
  "PackageSelect4", "BookingSelectB", "GetBookingFullDetails2", "SearchContactByEmailEncoded", "GetContactWithInvoiceAddress1",
  "UpdateClient", "GetBookingFullDetails3", "GetBookingItems", "GetBookingFullDetails4", "UpdateBookingWithContact", "GetBookingFullDetails5",
  "GetContactWithInvoiceAddress2", "PackageSelect5", "PackageSelect6", "PackageSelect7", "PackageSelect8", "InvoiceCreate",
  "GetContactWithInvoiceAddress3", "GetBookingFullDetails6", "GetBookingFullDetails7", "PaymentSelect", "PaymentCreditCardTypes",
  "GetBookingFullDetails8", "BookingInvoices", "CreatePayment", "ConfirmBooking", "EmailTemplate", "GenerateEmail",
  "SendEmail", "PackageSelect9", "PackageSelect10", "GetInvoiceById"
];

// Smoke correlation IDs to show in the generated HTML report.
// Using Gauge metrics (numeric) so we don't rely on tagged metric parsing.
const smokeClientIdGauge = new Gauge("smoke_client_id");
const smokeContactIdGauge = new Gauge("smoke_contact_id");
const smokeBookingIdGauge = new Gauge("smoke_booking_id");

function thinkTime() {
  const min = Number.isFinite(THINK_TIME_MIN_S) ? THINK_TIME_MIN_S : 0.2;
  const max = Number.isFinite(THINK_TIME_MAX_S) ? THINK_TIME_MAX_S : 1.0;
  const high = Math.max(min, max);
  const low = Math.min(min, max);
  const delay = low + Math.random() * (high - low);
  sleep(delay);
}

function getModeOptions(testMode) {
  if (testMode === "peak200") return loadProfile.peak200;
  if (testMode === "peak300") return loadProfile.peak300;
  if (testMode === "peak400") return loadProfile.peak400;
  if (testMode === "peak") return loadProfile.peak;
  if (testMode === "peak100_sustained") return loadProfile.peak100_sustained;
  if (testMode === "peak100_10m") return loadProfile.peak100_10m;
  if (testMode === "peak100_constant_10m") return loadProfile.peak100_constant_10m;
  if (testMode === "peak500_10m") return loadProfile.peak500_10m;
  if (testMode === "peak500_constant_10m") return loadProfile.peak500_constant_10m;
  if (testMode === "peak50_5m") return loadProfile.peak50_5m;
  if (testMode === "peak20_10m") return loadProfile.peak20_10m;
  return loadProfile.smoke;
}

const baseOptions = getModeOptions(mode);
const hasPeakSteadyScenario = !!(baseOptions && baseOptions.scenarios && baseOptions.scenarios.peak_steady);
export const options = {
  ...baseOptions,
  thresholds: {
    ...(baseOptions.thresholds || {}),
    http_req_failed: ["rate<0.01"],
    http_req_duration: [`p(95)<${P95_LIMIT_MS}`, `p(99)<${P99_LIMIT_MS}`],
    ...(hasPeakSteadyScenario ? {
      "http_req_failed{scenario:peak_steady}": ["rate<0.01"],
      "http_req_duration{scenario:peak_steady}": [`p(95)<${P95_LIMIT_MS}`, `p(99)<${P99_LIMIT_MS}`],
    } : {}),
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};
for (const step of flowStepOrder) {
  const selector = `{flow_step:${step}}`;
  options.thresholds[`endpoint_requests${selector}`] = ["count>=0"];
  options.thresholds[`endpoint_duration${selector}`] = ["avg>=0"];
  options.thresholds[`endpoint_failures${selector}`] = ["count>=0"];
}

export function setup() {
  if (PER_VU_LOGIN) return { perVuLogin: true };
  const token = ENABLE_RETRIES ? retry(() => login(), { attempts: 3, delayMs: 1000 }) : login();
  return { perVuLogin: false, token };
}

function readMetricValue(data, metricName, field, fallback = 0) {
  const v = data?.metrics?.[metricName]?.values?.[field];
  return typeof v === "number" ? v : fallback;
}

function readChecksOutcome(data) {
  const v = data?.metrics?.checks?.values || {};
  return {
    passed: typeof v.passes === "number" ? v.passes : 0,
    failed: typeof v.fails === "number" ? v.fails : 0,
  };
}

function readCounterSum(values) {
  if (!values || typeof values !== "object") return 0;
  const c = values.count;
  return typeof c === "number" && !Number.isNaN(c) ? c : 0;
}

function readHttpFailedRequestCount(data, fallbackRate = 0) {
  const m = data?.metrics?.http_req_failed;
  const values = m?.values || {};
  const rate = typeof values.rate === "number" ? values.rate : fallbackRate;
  // For http_req_failed (Rate metric), `passes` is the number of failed requests (true samples).
  if (typeof values.passes === "number") return { rate, failedRequests: values.passes };
  if (typeof values.count === "number") return { rate, failedRequests: Math.round(values.count * rate) };
  return { rate, failedRequests: 0 };
}

function getSubmetricValue(data, metricName, endpoint, method, field) {
  const metric = data?.metrics?.[metricName];
  if (!metric?.submetrics) return 0;
  const entries = Object.entries(metric.submetrics);
  for (const [k, sub] of entries) {
    const key = k.replace(/\s+/g, "");
    const endpointMatch = key.includes(`endpoint:${endpoint.replace(/\s+/g, "")}`);
    const methodMatch = method ? key.includes(`method:${method}`) : true;
    if (endpointMatch && methodMatch) {
      return sub?.values?.[field] || 0;
    }
  }
  return 0;
}

function parseTagsFromMetricKey(metricKey) {
  const start = metricKey.indexOf("{");
  const end = metricKey.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  const raw = metricKey.slice(start + 1, end);
  const tags = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    tags[k] = v;
  }
  return tags;
}

function getTaggedMetricValues(data, metricName, step) {
  const metrics = data?.metrics || {};
  const rows = [];
  for (const [key, metric] of Object.entries(metrics)) {
    if (!key.startsWith(`${metricName}{`)) continue;
    const tags = parseTagsFromMetricKey(key);
    if ((tags.flow_step || "") !== step) continue;
    rows.push({ key, tags, values: metric?.values || {} });
  }
  return rows;
}

function toSeconds(ms) {
  return (ms || 0) / 1000;
}

function normalizeEndpointName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getStepMeta(step) {
  if (step.startsWith("PackageSelect")) return { endpoint: "Package Select", method: "GET" };
  if (step.startsWith("GetBookingFullDetails")) return { endpoint: "Get Booking Full Details", method: "GET" };
  if (step.startsWith("GetContactWithInvoiceAddress")) return { endpoint: "Get Contact With Invoice Address", method: "GET" };
  if (step === "Login") return { endpoint: "Login", method: "POST" };
  if (step === "ClientCategory") return { endpoint: "Client Category", method: "GET" };
  if (step === "ClientType") return { endpoint: "Client Type", method: "GET" };
  if (step === "ClientTitle") return { endpoint: "Client Title", method: "GET" };
  if (step === "CommunicationTypes") return { endpoint: "Communication Types", method: "GET" };
  if (step === "Country") return { endpoint: "Country", method: "GET" };
  if (step === "CreateClient") return { endpoint: "Create Client", method: "POST" };
  if (step === "GetContact") return { endpoint: "Get Contact", method: "GET" };
  if (step === "SearchContactByEmail" || step === "SearchContactByEmailEncoded") return { endpoint: "Search Contact By Email", method: "GET" };
  if (step === "FindPriorityAccessBooking") return { endpoint: "Find Priority Access Booking", method: "GET" };
  if (step === "CreateBooking") return { endpoint: "Create Booking", method: "POST" };
  if (step === "UpdateBookingIsPA") return { endpoint: "Update Booking IsPA", method: "PATCH" };
  if (step === "SearchBookingByEmail") return { endpoint: "Search Booking By Email", method: "GET" };
  if (step === "AddPackage") return { endpoint: "Add Package", method: "PATCH" };
  if (step === "BookingSelectA" || step === "BookingSelectB") return { endpoint: "Booking Select", method: "GET" };
  if (step === "UpdateClient") return { endpoint: "Update Client", method: "PATCH" };
  if (step === "GetBookingItems") return { endpoint: "Get Booking Items", method: "GET" };
  if (step === "UpdateBookingWithContact") return { endpoint: "Update Booking with contact", method: "PATCH" };
  if (step === "InvoiceCreate") return { endpoint: "Invoice Create", method: "POST" };
  if (step === "PaymentSelect") return { endpoint: "Payment Select", method: "GET" };
  if (step === "PaymentCreditCardTypes") return { endpoint: "Payment Credit Card Types", method: "GET" };
  if (step === "BookingInvoices") return { endpoint: "Booking Invoices", method: "GET" };
  if (step === "CreatePayment") return { endpoint: "Create Payment", method: "POST" };
  if (step === "ConfirmBooking") return { endpoint: "Confirm Booking", method: "PATCH" };
  if (step === "EmailTemplate") return { endpoint: "Email Template", method: "GET" };
  if (step === "GenerateEmail") return { endpoint: "Generate Email", method: "POST" };
  if (step === "SendEmail") return { endpoint: "Send Email", method: "POST" };
  if (step === "GetInvoiceById") return { endpoint: "Get Invoice By ID", method: "GET" };
  return { endpoint: step, method: "N/A" };
}

function formatSec(v) {
  return `${(v || 0).toFixed(2)} s`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
}

function formatRunId(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}_${pad2(dt.getHours())}${pad2(dt.getMinutes())}${pad2(dt.getSeconds())}`;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

function buildEndpointRows(data) {
  const rows = [];
  for (const step of flowStepOrder) {
    const reqEntries = getTaggedMetricValues(data, "endpoint_requests", step);
    const durEntries = getTaggedMetricValues(data, "endpoint_duration", step);
    const failEntries = getTaggedMetricValues(data, "endpoint_failures", step);
    const totalRequests = reqEntries.reduce((n, e) => n + readCounterSum(e.values), 0);
    if (!totalRequests) continue;
    let failed = failEntries.reduce((n, e) => n + readCounterSum(e.values), 0);
    failed = Math.min(failed, totalRequests);
    const passed = Math.max(0, totalRequests - failed);
    const stepMeta = getStepMeta(step);
    const tagSource = reqEntries[0]?.tags || durEntries[0]?.tags || {};
    const endpointName = tagSource.endpoint || stepMeta.endpoint || step;
    const method = tagSource.method || stepMeta.method || "N/A";
    const durationValues = durEntries[0]?.values || {};
    const row = {
      endpoint: endpointName,
      step,
      method,
      totalRequests,
      passed,
      failed,
      avg: toSeconds(durationValues.avg || 0),
      p90: toSeconds(durationValues["p(90)"] || 0),
      p95: toSeconds(durationValues["p(95)"] || 0),
      p99: toSeconds(durationValues["p(99)"] || 0),
      min: toSeconds(durationValues.min || 0),
      max: toSeconds(durationValues.max || 0),
    };
    row.errorPct = row.totalRequests > 0 ? (row.failed / row.totalRequests) * 100 : 0;
    rows.push(row);
  }

  rows.sort((a, b) => flowStepOrder.indexOf(a.step) - flowStepOrder.indexOf(b.step));

  return rows;
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readGaugeValue(data, metricName) {
  const m = data?.metrics?.[metricName];
  const v = m?.values;
  if (!v) return "";
  const candidate = v.value ?? v.avg ?? v.max ?? "";
  if (candidate === "" || candidate == null) return "";
  return String(candidate);
}

function buildCorrelationIdsSection(data) {
  const clientId = readGaugeValue(data, "smoke_client_id");
  const contactId = readGaugeValue(data, "smoke_contact_id");
  const bookingId = readGaugeValue(data, "smoke_booking_id");

  const hasAny = Boolean(clientId || bookingId || contactId);

  if (!hasAny) {
    return `
  <div class="section">
    <h2>Correlation IDs</h2>
    <p style="margin:0;color:#64748b;font-size:13px">No correlation IDs were recorded (gauge metrics missing).</p>
  </div>
`;
  }

  return `
  <div class="section">
    <h2>Correlation IDs (client/booking)</h2>
    <table>
      <thead>
        <tr>
          <th>clientId</th>
          <th>contactId</th>
          <th>bookingId</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(clientId)}</td>
          <td>${escapeHtml(contactId)}</td>
          <td>${escapeHtml(bookingId)}</td>
        </tr>
      </tbody>
    </table>
    <p style="margin:10px 0 0;color:#64748b;font-size:12px">Note: recorded for the smoke run.</p>
  </div>
`;
}

function formatBucketLabel(sec) {
  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function buildTimelineData(data) {
  const metrics = data?.metrics || {};
  const points = new Map();

  for (const [name, metric] of Object.entries(metrics)) {
    let m;
    if ((m = name.match(/^ts_req_s(\d{4})$/))) {
      const sec = Number(m[1]);
      const point = points.get(sec) || { sec, req: 0, fail: 0, avg: 0, p90: 0, p95: 0, p99: 0 };
      point.req = metric?.values?.count || 0;
      points.set(sec, point);
      continue;
    }
    if ((m = name.match(/^ts_fail_s(\d{4})$/))) {
      const sec = Number(m[1]);
      const point = points.get(sec) || { sec, req: 0, fail: 0, avg: 0, p90: 0, p95: 0, p99: 0 };
      point.fail = metric?.values?.count || 0;
      points.set(sec, point);
      continue;
    }
    if ((m = name.match(/^ts_dur_s(\d{4})$/))) {
      const sec = Number(m[1]);
      const point = points.get(sec) || { sec, req: 0, fail: 0, avg: 0, p90: 0, p95: 0, p99: 0 };
      point.avg = toSeconds(metric?.values?.avg || 0);
      point.p90 = toSeconds(metric?.values?.["p(90)"] || 0);
      point.p95 = toSeconds(metric?.values?.["p(95)"] || 0);
      point.p99 = toSeconds(metric?.values?.["p(99)"] || 0);
      points.set(sec, point);
    }
  }

  const sorted = [...points.values()].sort((a, b) => a.sec - b.sec);
  const labels = sorted.map((p) => formatBucketLabel(p.sec));
  return {
    labels,
    reqPerSec: sorted.map((p) => Number((p.req || 0).toFixed(3))),
    errorPct: sorted.map((p) => Number(((p.req > 0 ? (p.fail / p.req) * 100 : 0)).toFixed(3))),
    avg: sorted.map((p) => Number((p.avg || 0).toFixed(3))),
    p90: sorted.map((p) => Number((p.p90 || 0).toFixed(3))),
    p95: sorted.map((p) => Number((p.p95 || 0).toFixed(3))),
    p99: sorted.map((p) => Number((p.p99 || 0).toFixed(3))),
  };
}

function countBreachedThresholds(data) {
  let breached = 0;
  for (const metric of Object.values(data?.metrics || {})) {
    const thresholds = metric?.thresholds || {};
    for (const v of Object.values(thresholds)) {
      if (v?.ok === false) breached += 1;
    }
  }
  return breached;
}

function buildCustomReport(data) {
  const reportGeneratedAt = new Date();
  const testDurationMs = data?.state?.testRunDurationMs || 0;
  const testEnd = reportGeneratedAt;
  const testStart = new Date(testEnd.getTime() - testDurationMs);
  const runId = formatRunId(reportGeneratedAt);
  const totalRequests = readMetricValue(data, "http_reqs", "count");
  const failedInfo = readHttpFailedRequestCount(data);
  const passedRequests = Math.max(0, totalRequests - failedInfo.failedRequests);
  const checksOutcome = readChecksOutcome(data);
  const passedChecks = checksOutcome.passed;
  const failedChecks = checksOutcome.failed;
  const errorPct = failedInfo.rate * 100;
  const avgSec = toSeconds(readMetricValue(data, "http_req_duration", "avg"));
  const minSec = toSeconds(readMetricValue(data, "http_req_duration", "min"));
  const maxSec = toSeconds(readMetricValue(data, "http_req_duration", "max"));
  const p95Sec = toSeconds(readMetricValue(data, "http_req_duration", "p(95)"));
  const p99Sec = toSeconds(readMetricValue(data, "http_req_duration", "p(99)"));
  const throughput = readMetricValue(data, "http_reqs", "rate");
  const breachedThresholds = countBreachedThresholds(data);
  const endpointRows = buildEndpointRows(data);
  const testDurationSec = Math.max(testDurationMs / 1000, 1);

  const tableRowsHtml = endpointRows.map((r, i) => {
    const isFailed = r.failed > 0;
    const isSlow = r.avg >= 3 || r.p95 >= 3;
    const rowClass = isFailed && isSlow ? "row-failed-slow" : (isFailed ? "row-failed" : (isSlow ? "row-slow" : ""));
    return `<tr class="${rowClass}">
      <td>${i + 1}</td>
      <td>${r.step} - ${r.endpoint}</td>
      <td>${r.method}</td>
      <td>${r.avg.toFixed(2)} s</td>
      <td>${r.p95.toFixed(2)} s</td>
      <td>${r.p99.toFixed(2)} s</td>
      <td>${r.min.toFixed(2)} s</td>
      <td>${r.max.toFixed(2)} s</td>
      <td>${r.totalRequests}</td>
      <td>${r.passed}</td>
      <td>${r.failed}</td>
    </tr>`;
  }).join("");

  const chartData = {
    labels: endpointRows.map((r) => `${r.step}`),
    min: endpointRows.map((r) => Number(r.min.toFixed(3))),
    avg: endpointRows.map((r) => Number(r.avg.toFixed(3))),
    p95: endpointRows.map((r) => Number(r.p95.toFixed(3))),
    max: endpointRows.map((r) => Number(r.max.toFixed(3))),
    errorPct: endpointRows.map((r) => Number(r.errorPct.toFixed(3))),
    throughput: endpointRows.map((r) => Number((r.totalRequests / testDurationSec).toFixed(3))),
  };
  const correlationIdsSectionHtml = buildCorrelationIdsSection(data);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>k6 Performance Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f7fb; color: #1f2937; }
    h1,h2 { margin: 0 0 10px 0; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 10px; margin: 8px 0 16px 0; }
    .meta-item { background:#eef2ff; border:1px solid #c7d2fe; border-radius:8px; padding:10px; font-size:13px; }
    .meta-item b { color:#1e3a8a; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
    .label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    .value { font-size: 24px; font-weight: 700; margin-top: 6px; }
    .section { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: right; }
    .row-failed td { background: #fff1f2; }
    .row-slow td { background: #fff7ed; }
    .row-failed-slow td { background: #fee2e2; }
    th:nth-child(2), td:nth-child(2) { text-align: left; }
    th:nth-child(3), td:nth-child(3) { text-align: center; }
    th { background: #0f172a; color: #fff; position: sticky; top: 0; }
    .table-wrap { max-height: 520px; overflow: auto; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 10px; }
    .mini { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    .mini .k { font-size: 12px; color: #6b7280; }
    .mini .v { font-size: 18px; margin-top: 4px; font-weight: 700; }
    .chart-box { margin-top: 12px; }
    canvas { width: 100% !important; max-height: 350px; }
  </style>
</head>
<body>
  <h1>Load Test Report</h1>
  <div class="meta">
    <div class="meta-item"><b>Report Generated:</b> ${formatDateTime(reportGeneratedAt)}</div>
    <div class="meta-item"><b>Run ID:</b> ${runId}</div>
    <div class="meta-item"><b>Environment / Mode:</b> ${environmentName} / ${mode}</div>
    <div class="meta-item"><b>Test Start:</b> ${formatDateTime(testStart)}</div>
    <div class="meta-item"><b>Test End:</b> ${formatDateTime(testEnd)}</div>
    <div class="meta-item"><b>Total Test Duration:</b> ${formatDuration(testDurationMs)}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="label">Total Requests</div><div class="value">${totalRequests}</div></div>
    <div class="card"><div class="label">Passed Requests</div><div class="value">${passedRequests}</div></div>
    <div class="card"><div class="label">Failed Requests</div><div class="value">${failedInfo.failedRequests}</div></div>
    <div class="card"><div class="label">Breached Thresholds</div><div class="value">${breachedThresholds}</div></div>
    <div class="card"><div class="label">Passed Checks</div><div class="value">${passedChecks}</div></div>
    <div class="card"><div class="label">Failed Checks</div><div class="value">${failedChecks}</div></div>
  </div>

  <div class="section">
    <h2>Performance Summary</h2>
    <div class="summary-grid">
      <div class="mini"><div class="k">Total Requests</div><div class="v">${totalRequests}</div></div>
      <div class="mini"><div class="k">Avg Response Time</div><div class="v">${formatSec(avgSec)}</div></div>
      <div class="mini"><div class="k">Min Response Time</div><div class="v">${formatSec(minSec)}</div></div>
      <div class="mini"><div class="k">Max Response Time</div><div class="v">${formatSec(maxSec)}</div></div>
      <div class="mini"><div class="k">P95</div><div class="v">${formatSec(p95Sec)}</div></div>
      <div class="mini"><div class="k">P99</div><div class="v">${formatSec(p99Sec)}</div></div>
      <div class="mini"><div class="k">Throughput</div><div class="v">${throughput.toFixed(2)} req/s</div></div>
      <div class="mini"><div class="k">Error %</div><div class="v">${errorPct.toFixed(2)}%</div></div>
      <div class="mini"><div class="k">Test Start</div><div class="v" style="font-size:14px">${formatDateTime(testStart)}</div></div>
      <div class="mini"><div class="k">Test End</div><div class="v" style="font-size:14px">${formatDateTime(testEnd)}</div></div>
      <div class="mini"><div class="k">Duration</div><div class="v">${formatDuration(testDurationMs)}</div></div>
      <div class="mini"><div class="k">Run ID</div><div class="v" style="font-size:14px">${runId}</div></div>
    </div>
  </div>

  <div class="section">
    <h2>API Execution Table</h2>
    <p style="margin:0 0 12px 0;color:#475569;font-size:13px;line-height:1.5"><strong>Total</strong> / <strong>Passed</strong> / <strong>Failed</strong> from <code>endpoint_requests</code> and <code>endpoint_failures</code> per step (Passed = Total − Failed).</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Endpoint Name</th><th>Method</th><th>Avg</th><th>P95</th><th>P99</th><th>Min</th><th>Max</th><th>Total</th><th>Passed</th><th>Failed</th>
          </tr>
        </thead>
        <tbody>${tableRowsHtml}</tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <h2>Endpoint Comparison (Grouped Bar Chart)</h2>
    <p style="margin:0 0 10px 0;color:#475569;font-size:13px">Min, Avg, P95, Max response time (seconds) and Error % per endpoint. Suitable for load test reporting.</p>
    <div class="chart-box"><canvas id="endpointComparisonChart"></canvas></div>
  </div>

  ${correlationIdsSectionHtml}

  <script>
    const d = ${JSON.stringify(chartData)};
    const colors = {
      avg: "#2563eb", p90: "#7c3aed", p95: "#ea580c", p99: "#dc2626", min: "#059669", max: "#b45309", err: "#ef4444", throughput: "#0ea5e9"
    };

    new Chart(document.getElementById("endpointComparisonChart"), {
      type: "bar",
      data: {
        labels: d.labels,
        datasets: [
          { label: "Min (s)", data: d.min, backgroundColor: colors.min, yAxisID: "y" },
          { label: "Avg (s)", data: d.avg, backgroundColor: colors.avg, yAxisID: "y" },
          { label: "P95 (s)", data: d.p95, backgroundColor: colors.p95, yAxisID: "y" },
          { label: "Max (s)", data: d.max, backgroundColor: colors.max, yAxisID: "y" },
          { label: "Error %", data: d.errorPct, backgroundColor: colors.err, yAxisID: "y1" }
        ]
      },
      options: {
        plugins: { legend: { position: "top" } },
        scales: {
          x: { ticks: { maxRotation: 70, minRotation: 70, autoSkip: false }, title: { display: true, text: "Flow Steps" } },
          y: { title: { display: true, text: "Seconds" } },
          y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Error %" } }
        }
      }
    });
  </script>
</body>
</html>`;
}

export function handleSummary(data) {
  return {
    "report.html": buildCustomReport(data),
    "summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

function track(_endpointName, fn) {
  exec.vu.tags.flow_step = _endpointName;
  try {
    return fn();
  } catch (e) {
    throw e;
  } finally {
    delete exec.vu.tags.flow_step;
    thinkTime();
  }
}

function logUnhandledFlowError(error, ctx = {}) {
  const failure = error?.k6Failure || {};
  const flowStep = failure.flowStep || exec?.vu?.tags?.flow_step || "UNMAPPED_STEP";
  const message = error?.message || String(error || "Unknown error");
  const stack = error?.stack ? String(error.stack) : "";
  const contextData = (ctx && typeof ctx === "object") ? ctx : {};
  const details = {
    endpoint: failure.endpoint || flowStep,
    status: failure.status || "EXCEPTION",
    errorMessage: message,
    bookingId: failure.bookingId || contextData.bookingId,
    contactId: failure.contactId || contextData.contactId,
    clientId: failure.clientId || contextData.rClientId || contextData.clientId,
    invoiceId: failure.invoiceId || contextData.invoiceId,
    emailId: failure.emailId || contextData.emailId,
    templateId: failure.templateId || contextData.templateId,
    paymentTermDetailId: failure.paymentTermDetailId || contextData.paymentTermDetailId,
  };
  logErrorReport(details);
  logFailedRequest({
    requestTime: new Date().toISOString(),
    endpoint: failure.endpoint || flowStep,
    url: failure.url || "",
    method: failure.method || "",
    status: failure.status || "EXCEPTION",
    responseTimeMs: failure.responseTimeMs ?? null,
    networkError: failure.networkError || message,
    networkErrorCode: failure.networkErrorCode || "",
    requestBody: failure.requestBody || "",
    responseBody: failure.responseBody || stack || message,
    ...details,
  });
}

export default function (setupData) {
  let authRetries = 0;
  let done = false;
  const sharedToken = setupData && !setupData.perVuLogin && setupData.token ? setupData.token : null;
  const ctx = {
    contactId: __ENV.CONTACT_ID || null,
    contactEmail: __ENV.CONTACT_EMAIL || null,
  };

  while (!done) {
    try {
      if (sharedToken) {
        ctx.token = sharedToken;
      } else {
        group("001 Login", () => {
          ctx.token = track("Login", () => (ENABLE_RETRIES ? retry(() => login(), { attempts: 3, delayMs: 1000 }) : login()));
        });
      }

      group("002 ClientCategory", () => { ctx.clientCategoryId = track("ClientCategory", () => clientCategory(ctx.token)); });
      group("003 ClientType", () => { ctx.clientTypeId = track("ClientType", () => clientType(ctx.token)); });
      group("004 ClientTitle", () => { ctx.clientTitleId = track("ClientTitle", () => clientTitle(ctx.token)?.titleId); });
      group("005 communication-types", () => { Object.assign(ctx, track("CommunicationTypes", () => communicationTypes(ctx.token))); });
      group("006 Country", () => { ctx.countryId = track("Country", () => country(ctx.token)?.countryId); });

      group("007 Create Client", () => {
        const out = track("CreateClient", () => createClient(ctx.token, ctx.clientCategoryId, ctx.clientTypeId, ctx.clientTitleId, ctx.officeEmailId, ctx.personalEmailId, ctx.mobileId, ctx.homePhoneId, ctx.countryId));
        ctx.contactId = out?.contactId || ctx.contactId;
        ctx.rClientId = out?.clientId || ctx.rClientId;
        ctx.contactEmail = out?.contactEmail || ctx.contactEmail;
        if (__VU === 1) {
          const cId = Number(ctx.rClientId ?? 0);
          const ctId = Number(ctx.contactId ?? 0);
          if (Number.isFinite(cId)) smokeClientIdGauge.add(cId);
          if (Number.isFinite(ctId)) smokeContactIdGauge.add(ctId);
        }
        console.log(`SMOKE_IDS clientId=${ctx.rClientId ?? "(null)"} contactId=${ctx.contactId ?? "(null)"} email=${ctx.contactEmail ?? "(null)"} vu=${__VU ?? "(n/a)"} iter=${__ITER ?? "(n/a)"}`);
      });
      if (!ctx.contactId) ctx.contactId = __ENV.CONTACT_ID || "1";

      group("008 GET Contact", () => {
        const out = track("GetContact", () => getCustomer(ctx.token, ctx.contactId));
        Object.assign(ctx, out || {});
      });
      if (!ctx.contactEmail) ctx.contactEmail = __ENV.CONTACT_EMAIL || "";
      group("009 Search Contact By Email", () => { Object.assign(ctx, track("SearchContactByEmail", () => searchContactByEmail(ctx.token, ctx.contactEmail))); });
      if (!ctx.contactId) ctx.contactId = __ENV.CONTACT_ID || "1";
      group("010 Find Priority Access booking", () => { ctx.bookingId = track("FindPriorityAccessBooking", () => findPriorityAccessBooking(ctx.token, ctx.contactEmail)) || ctx.bookingId; });

      group("011 Empty Booking create", () => {
        const out = track("CreateBooking", () => (ENABLE_RETRIES ? retry(() => createBooking(ctx.token, ctx.contactId), { attempts: 3, delayMs: 1000 }) : createBooking(ctx.token, ctx.contactId)));
        ctx.bookingId = out?.bookingId || ctx.bookingId;
        ctx.contactId = out?.contactId || ctx.contactId;
      });
      group("012 Update Booking isPA_UserDefinedFieldValue", () => { track("UpdateBookingIsPA", () => updateBookingIsPaUserDefinedFieldValue(ctx.token, ctx.bookingId)); });
      group("013 Search Booking By Email", () => { ctx.bookingId = track("SearchBookingByEmail", () => searchBookingByEmail(ctx.token, ctx.contactEmail)) || ctx.bookingId; });
      if (!ctx.bookingId) throw new Error("booking_id correlation failed after create/search booking");
      if (__VU === 1) {
        const bId = Number(ctx.bookingId ?? 0);
        if (Number.isFinite(bId)) smokeBookingIdGauge.add(bId);
      }
      console.log(`SMOKE_IDS bookingId=${ctx.bookingId ?? "(null)"} clientId=${ctx.rClientId ?? "(null)"} contactId=${ctx.contactId ?? "(null)"} email=${ctx.contactEmail ?? "(null)"} vu=${__VU ?? "(n/a)"} iter=${__ITER ?? "(n/a)"}`);

      group("014 Package_Select 1", () => { Object.assign(ctx, track("PackageSelect1", () => packageSelect(ctx.token))); });
      group("015 Package_Select 2", () => { Object.assign(ctx, track("PackageSelect2", () => packageSelect(ctx.token))); });
      group("016 BookingsPatch- Package adding", () => {
        const out = track("AddPackage", () => addPackage(ctx.token, ctx.bookingId, ctx.packageId, ctx.pStartDate, ctx.pEndDate));
        ctx.paymentTermDetailId = out?.paymentTermDetailId || ctx.paymentTermDetailId;
      });
      group("017 Bookings-Select", () => { Object.assign(ctx, track("BookingSelectA", () => bookingSelect(ctx.token, ctx.bookingId))); });
      group("018 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails1", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("019 Package_Select 1", () => { Object.assign(ctx, track("PackageSelect3", () => packageSelect(ctx.token))); });
      group("020 Package_Select 2", () => { Object.assign(ctx, track("PackageSelect4", () => packageSelect(ctx.token))); });
      group("021 Booking Select", () => { Object.assign(ctx, track("BookingSelectB", () => bookingSelect(ctx.token, ctx.bookingId))); });
      group("022 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails2", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });

      group("023 Search Contact By Email", () => { Object.assign(ctx, track("SearchContactByEmailEncoded", () => searchContactByEmail(ctx.token, ctx.contactEmail))); });
      group("024 Get Contact With Invoice Address", () => { Object.assign(ctx, track("GetContactWithInvoiceAddress1", () => getContactWithInvoiceAddress(ctx.token, ctx.contactId))); });
      group("025 Update Client", () => { track("UpdateClient", () => updateClient(ctx.token, ctx.rClientId)); });
      group("026 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails3", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("027 Get Booking Items", () => { ctx.bookingItemId = track("GetBookingItems", () => getBookingItems(ctx.token, ctx.bookingId)); });
      group("028 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails4", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("029 Update Booking with contact", () => { track("UpdateBookingWithContact", () => addClient(ctx.token, ctx.bookingId, ctx.contactId)); });
      group("030 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails5", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("031 Get Contact With Invoice Address", () => { Object.assign(ctx, track("GetContactWithInvoiceAddress2", () => getContactWithInvoiceAddress(ctx.token, ctx.contactId))); });

      group("032 Package_Select 1", () => { Object.assign(ctx, track("PackageSelect5", () => packageSelect(ctx.token))); });
      group("033 Package_Select 2", () => { Object.assign(ctx, track("PackageSelect6", () => packageSelect(ctx.token))); });
      group("034 Package_Select 3", () => { Object.assign(ctx, track("PackageSelect7", () => packageSelect(ctx.token))); });
      group("035 Package_Select 4", () => { Object.assign(ctx, track("PackageSelect8", () => packageSelect(ctx.token))); });

      group("036 InvoiceCreate", () => { ctx.invoiceId = track("InvoiceCreate", () => invoiceCreate(ctx.token, ctx.bookingId, ctx.paymentTermDetailId)); });
      group("037 Get Contact With Invoice Address", () => { Object.assign(ctx, track("GetContactWithInvoiceAddress3", () => getContactWithInvoiceAddress(ctx.token, ctx.contactId))); });
      group("038 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails6", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("039 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails7", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("040 Booking Payment GET", () => { track("PaymentSelect", () => paymentSelect(ctx.token, ctx.bookingId)); });
      group("041 Payment-credit-card-types", () => { track("PaymentCreditCardTypes", () => paymentCreditCardTypes(ctx.token)); });
      group("042 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails8", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("043 BookingInvoices", () => {
        const inv = track("BookingInvoices", () => bookingInvoices(ctx.token, ctx.bookingId));
        ctx.invoiceId = inv?.id || ctx.invoiceId;
        ctx.totalAmount = inv?.amount || ctx.totalAmount;
      });
      if (!ctx.invoiceId && !ctx.totalAmount) {
        const full = track("GetBookingFullDetailsForInvoiceFallback", () => getBookingFullDetails(ctx.token, ctx.bookingId));
        ctx.invoiceId = full?.invoiceId || ctx.invoiceId;
      }
      group("044 Payment", () => { track("CreatePayment", () => createPayment(ctx.token, ctx.bookingId, ctx.invoiceId, ctx.totalAmount)); });
      group("045 Confirm booking", () => { track("ConfirmBooking", () => confirmBooking(ctx.token, ctx.bookingId)); });
      group("046 EmailTemplate", () => { ctx.templateId = track("EmailTemplate", () => emailTemplate(ctx.token)); });
      if (__ENV.ECOM_BOOKING_CONFIRMATION_EMAIL_TEMPLATE) ctx.templateId = __ENV.ECOM_BOOKING_CONFIRMATION_EMAIL_TEMPLATE;
      group("047 BookingEmailGenerate", () => { ctx.emailId = track("GenerateEmail", () => generateEmail(ctx.token, ctx.bookingId, ctx.templateId)?.emailId); });
      group("048 BookingEmailSend", () => { track("SendEmail", () => sendEmail(ctx.token, ctx.bookingId, ctx.emailId)); });
      group("049 Package_Select 1", () => { track("PackageSelect9", () => packageSelect(ctx.token)); });
      group("050 Package_Select 2", () => { track("PackageSelect10", () => packageSelect(ctx.token)); });
      group("051 Get Invoice By ID", () => { track("GetInvoiceById", () => getInvoiceById(ctx.token, ctx.invoiceId)); });

      done = true;
    } catch (e) {
      if (ENABLE_TOKEN_REFRESH_ON_401 && e.message === UNAUTHORIZED_MSG && authRetries < MAX_401_RETRIES) {
        authRetries += 1;
        ctx.token = track("LoginRefresh", () => login());
      } else {
        if (!e.k6Failure) {
          logUnhandledFlowError(e, ctx);
        }
        throw e;
      }
    }
  }
}