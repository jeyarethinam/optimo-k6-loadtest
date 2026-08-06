/**
 * HRP HTML report — glassmorphism UX (aligned with client sample) + accurate k6 flow metrics.
 */
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

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
  if (typeof values.passes === "number") return { rate, failedRequests: values.passes };
  if (typeof values.count === "number") return { rate, failedRequests: Math.round(values.count * rate) };
  return { rate, failedRequests: 0 };
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
    tags[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
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
  return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
}

function formatSec(v) {
  return `${(v || 0).toFixed(2)} s`;
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
  const v = data?.metrics?.[metricName]?.values;
  if (!v) return "";
  const candidate = v.value ?? v.avg ?? v.max ?? "";
  return candidate === "" || candidate == null ? "" : String(candidate);
}

function countBreachedThresholds(data) {
  let breached = 0;
  for (const metric of Object.values(data?.metrics || {})) {
    for (const t of Object.values(metric?.thresholds || {})) {
      if (t?.ok === false) breached += 1;
    }
  }
  return breached;
}

function getStepMeta(step) {
  const map = {
    Login: { endpoint: "Login", method: "POST" },
    ListBookings: { endpoint: "List Bookings", method: "GET" },
    CreateBooking: { endpoint: "Create Booking", method: "POST" },
    GetBooking: { endpoint: "Get Booking", method: "GET" },
    GetNotes: { endpoint: "Get Notes", method: "GET" },
    GetAuditHistories: { endpoint: "Get Audit Histories", method: "GET" },
    Add50Packages: { endpoint: "Add 50 Packages", method: "PATCH" },
    GetBookingAfterPackages: { endpoint: "Get Booking", method: "GET" },
    SubmitBooking: { endpoint: "Submit Booking", method: "PATCH" },
    UnsubmitBooking: { endpoint: "Unsubmit Booking", method: "PATCH" },
    CancelBooking: { endpoint: "Cancel Booking", method: "POST" },
    LoginRefresh: { endpoint: "Login", method: "POST" },
  };
  return map[step] || { endpoint: step, method: "N/A" };
}

function mergeDurationValuesForStep(durEntries) {
  if (!durEntries.length) return {};
  if (durEntries.length === 1) return durEntries[0].values || {};
  let wSum = 0;
  let avgSum = 0;
  let minV = Infinity;
  let maxV = -Infinity;
  let best = durEntries[0].values || {};
  let bestCount = best.count || 0;
  for (const e of durEntries) {
    const v = e.values || {};
    const w = v.count || 0;
    if (w > 0) {
      avgSum += (v.avg || 0) * w;
      wSum += w;
    }
    if (typeof v.min === "number") minV = Math.min(minV, v.min);
    if (typeof v.max === "number") maxV = Math.max(maxV, v.max);
    if (w > bestCount) {
      best = v;
      bestCount = w;
    }
  }
  return {
    avg: wSum > 0 ? avgSum / wSum : 0,
    min: minV === Infinity ? 0 : minV,
    max: maxV === -Infinity ? 0 : maxV,
    "p(90)": best["p(90)"] || 0,
    "p(95)": best["p(95)"] || 0,
    "p(99)": best["p(99)"] || 0,
  };
}

function buildEndpointRows(data, flowStepOrder) {
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
    const durationValues = mergeDurationValuesForStep(durEntries);
    const row = {
      endpoint: tagSource.endpoint || stepMeta.endpoint || step,
      step,
      method: tagSource.method || stepMeta.method || "N/A",
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

/**
 * @param {object} data k6 summary
 * @param {{ mode: string, environmentName: string, flowStepOrder: string[] }} opts
 */
export function buildHrpReport(data, opts) {
  const mode = opts.mode || "smoke";
  const environmentName = opts.environmentName || "HRP";
  const flowStepOrder = opts.flowStepOrder || [];
  const isSmoke = String(mode).toLowerCase() === "smoke";
  const reportKind = isSmoke ? "Smoke" : "Load";
  const reportKindLower = isSmoke ? "smoke" : "load";

  const reportGeneratedAt = new Date();
  const testDurationMs = data?.state?.testRunDurationMs || 0;
  const testEnd = reportGeneratedAt;
  const testStart = new Date(testEnd.getTime() - testDurationMs);
  const runId = formatRunId(reportGeneratedAt);

  const endpointRows = buildEndpointRows(data, flowStepOrder);
  // Accurate flow totals (match API Execution Table) — not raw http_reqs (session lookups inflate that).
  const flowTotal = endpointRows.reduce((n, r) => n + r.totalRequests, 0);
  const flowFailed = endpointRows.reduce((n, r) => n + r.failed, 0);
  const flowPassed = Math.max(0, flowTotal - flowFailed);

  const allHttp = readMetricValue(data, "http_reqs", "count");
  const httpFailedInfo = readHttpFailedRequestCount(data);
  const allHttpPassed = Math.max(0, allHttp - httpFailedInfo.failedRequests);
  const helperHttp = Math.max(0, allHttp - flowTotal);

  const checksOutcome = readChecksOutcome(data);
  const breachedThresholds = countBreachedThresholds(data);
  const errorPctFlow = flowTotal > 0 ? (flowFailed / flowTotal) * 100 : 0;
  const errorPctHttp = httpFailedInfo.rate * 100;

  const avgSec = toSeconds(readMetricValue(data, "http_req_duration", "avg"));
  const minSec = toSeconds(readMetricValue(data, "http_req_duration", "min"));
  const maxSec = toSeconds(readMetricValue(data, "http_req_duration", "max"));
  const medSec = toSeconds(readMetricValue(data, "http_req_duration", "med"));
  const p90Sec = toSeconds(readMetricValue(data, "http_req_duration", "p(90)"));
  const p95Sec = toSeconds(readMetricValue(data, "http_req_duration", "p(95)"));
  const p99Sec = toSeconds(readMetricValue(data, "http_req_duration", "p(99)"));
  const throughput = readMetricValue(data, "http_reqs", "rate");
  const vusMax = readMetricValue(data, "vus_max", "value", readMetricValue(data, "vus_max", "max", 0));
  const iterations = readMetricValue(data, "iterations", "count");

  const bookingId = readGaugeValue(data, "smoke_booking_id");
  const contactId = readGaugeValue(data, "smoke_contact_id");
  const packageCount = readGaugeValue(data, "smoke_package_count");

  const failCardClass = flowFailed > 0 ? "danger" : "success";
  const checkCardClass = checksOutcome.failed > 0 ? "danger" : "success";
  const threshCardClass = breachedThresholds > 0 ? "danger" : "success";

  // 1) Total Requests Summary — counts only (separate from latency / failures detail)
  const totalSummaryRowsHtml = endpointRows
    .map((r, i) => {
      return `<tr class="${r.failed > 0 ? "row-failed" : ""}">
        <td>${i + 1}</td>
        <td><b>${escapeHtml(r.endpoint)}</b><div class="step-sub">${escapeHtml(r.step)}</div></td>
        <td class="center">${escapeHtml(r.method)}</td>
        <td><b>${r.totalRequests}</b></td>
        <td class="good">${r.passed}</td>
        <td class="${r.failed > 0 ? "failed" : "good"}">${r.failed}</td>
        <td class="${r.errorPct > 0 ? "failed" : "good"}">${r.errorPct.toFixed(2)}%</td>
      </tr>`;
    })
    .join("");

  const totalSummaryFooter = `<tr class="totals-row">
    <td colspan="3"><b>TOTAL</b></td>
    <td><b>${flowTotal}</b></td>
    <td class="good"><b>${flowPassed}</b></td>
    <td class="${flowFailed > 0 ? "failed" : "good"}"><b>${flowFailed}</b></td>
    <td class="${errorPctFlow > 0 ? "failed" : "good"}"><b>${errorPctFlow.toFixed(2)}%</b></td>
  </tr>`;

  // 2) Failed Requests Summary — only endpoints with failures (separate table for load diagnosis)
  const failedRows = endpointRows.filter((r) => r.failed > 0);
  const failedSummaryRowsHtml = failedRows
    .map((r, i) => {
      return `<tr class="row-failed">
        <td>${i + 1}</td>
        <td><b>${escapeHtml(r.endpoint)}</b><div class="step-sub">${escapeHtml(r.step)}</div></td>
        <td class="center">${escapeHtml(r.method)}</td>
        <td>${r.totalRequests}</td>
        <td class="failed"><b>${r.failed}</b></td>
        <td class="failed">${r.errorPct.toFixed(2)}%</td>
        <td>${r.avg.toFixed(2)}</td>
        <td>${r.p95.toFixed(2)}</td>
        <td>${r.max.toFixed(2)}</td>
      </tr>`;
    })
    .join("");

  const failedSummaryFooter = failedRows.length
    ? `<tr class="totals-row">
        <td colspan="3"><b>FAILED TOTAL</b></td>
        <td><b>${failedRows.reduce((n, r) => n + r.totalRequests, 0)}</b></td>
        <td class="failed"><b>${flowFailed}</b></td>
        <td class="failed"><b>${errorPctFlow.toFixed(2)}%</b></td>
        <td colspan="3"></td>
      </tr>`
    : "";

  // 3) Latency-focused API table (timing only + counts)
  const tableRowsHtml = endpointRows
    .map((r, i) => {
      const rowClass = r.failed > 0 ? "row-failed" : r.avg >= 3 || r.p95 >= 3 ? "row-slow" : "";
      return `<tr class="${rowClass}">
        <td>${i + 1}</td>
        <td><b>${escapeHtml(r.endpoint)}</b><div class="step-sub">${escapeHtml(r.step)}</div></td>
        <td class="center">${escapeHtml(r.method)}</td>
        <td>${r.avg.toFixed(2)}</td>
        <td>${r.p90.toFixed(2)}</td>
        <td>${r.p95.toFixed(2)}</td>
        <td>${r.p99.toFixed(2)}</td>
        <td>${r.min.toFixed(2)}</td>
        <td>${r.max.toFixed(2)}</td>
        <td><b>${r.totalRequests}</b></td>
        <td class="good">${r.passed}</td>
        <td class="${r.failed > 0 ? "failed" : "good"}">${r.failed}</td>
      </tr>`;
    })
    .join("");

  const chartData = {
    labels: endpointRows.map((r) => r.endpoint),
    min: endpointRows.map((r) => Number(r.min.toFixed(3))),
    avg: endpointRows.map((r) => Number(r.avg.toFixed(3))),
    p95: endpointRows.map((r) => Number(r.p95.toFixed(3))),
    max: endpointRows.map((r) => Number(r.max.toFixed(3))),
    errorPct: endpointRows.map((r) => Number(r.errorPct.toFixed(3))),
    totals: endpointRows.map((r) => r.totalRequests),
  };

  const corrHtml = isSmoke
    ? `<div class="glass-panel">
        <h2><i class="fas fa-link"></i> Correlation IDs</h2>
        <table>
          <thead><tr><th>contactId</th><th>bookingId</th><th>packageCount</th></tr></thead>
          <tbody><tr>
            <td>${escapeHtml(contactId || "—")}</td>
            <td>${escapeHtml(bookingId || "—")}</td>
            <td>${escapeHtml(packageCount || "—")}</td>
          </tr></tbody>
        </table>
      </div>`
    : `<div class="glass-panel">
        <h2><i class="fas fa-link"></i> Correlation</h2>
        <p class="note">Load run — per-VU booking IDs are in <code>k6-run.log</code> (<code>HRP_IDS</code> / <code>HRP_PACKAGES</code>). Failed APIs are listed in the Error Capture section below.</p>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HRP ${reportKind} Test Report — ${escapeHtml(formatDateTime(reportGeneratedAt))}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg1: #0b1026;
      --bg2: #1a1440;
      --accent: #7c5cff;
      --accent2: #22d3ee;
      --glass: rgba(255,255,255,0.08);
      --glass-strong: rgba(255,255,255,0.12);
      --border: rgba(255,255,255,0.18);
      --text: #f8fafc;
      --muted: #cbd5e1;
      --good: #34d399;
      --bad: #fb7185;
      --warn: #fbbf24;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Outfit', system-ui, sans-serif;
      color: var(--text);
      min-height: 100vh;
      background:
        radial-gradient(1200px 600px at 10% -10%, rgba(124,92,255,0.45), transparent 55%),
        radial-gradient(900px 500px at 90% 0%, rgba(34,211,238,0.28), transparent 50%),
        linear-gradient(160deg, var(--bg1), var(--bg2) 55%, #0f172a);
      padding: 1.5rem;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: rgba(15, 23, 42, 0.45);
      border: 1px solid var(--border);
      border-radius: 24px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
      backdrop-filter: blur(22px);
      overflow: hidden;
    }
    header {
      padding: 1.75rem 2rem;
      background: linear-gradient(120deg, rgba(124,92,255,0.55), rgba(34,211,238,0.25));
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.35rem 0.85rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.12);
      backdrop-filter: blur(10px);
    }
    .badge.smoke { background: rgba(34,211,238,0.25); color: #a5f3fc; }
    .badge.load { background: rgba(251,113,133,0.25); color: #fecdd3; }
    .content { padding: 1.5rem 1.75rem 2rem; }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .meta-item {
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 0.85rem 1rem;
      backdrop-filter: blur(12px);
      font-size: 0.88rem;
      color: var(--muted);
    }
    .meta-item b { color: #fff; font-weight: 600; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin: 0 0 1.25rem;
    }
    .metric-card {
      position: relative;
      overflow: hidden;
      border-radius: 16px;
      padding: 1.25rem 1.35rem;
      border: 1px solid var(--border);
      background: var(--glass-strong);
      backdrop-filter: blur(16px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .metric-card:hover { transform: translateY(-3px); box-shadow: 0 16px 40px rgba(0,0,0,0.3); }
    .metric-card.primary { background: linear-gradient(135deg, rgba(102,126,234,0.85), rgba(118,75,162,0.85)); }
    .metric-card.success { background: linear-gradient(135deg, rgba(104,211,145,0.85), rgba(72,187,120,0.85)); }
    .metric-card.danger { background: linear-gradient(135deg, rgba(252,129,129,0.9), rgba(245,101,101,0.9)); }
    .metric-card.warning { background: linear-gradient(135deg, rgba(246,173,85,0.9), rgba(237,137,54,0.9)); }
    .metric-card .icon {
      position: absolute; right: 1rem; top: 50%; transform: translateY(-50%);
      font-size: 3.2rem; opacity: 0.18;
    }
    .metric-card h4 {
      margin: 0 0 0.35rem;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.92;
      position: relative; z-index: 2;
    }
    .metric-value {
      font-size: 2.35rem;
      font-weight: 700;
      position: relative; z-index: 2;
      font-variant-numeric: tabular-nums;
    }
    .metric-subtext {
      margin-top: 0.3rem;
      font-size: 0.8rem;
      opacity: 0.88;
      position: relative; z-index: 2;
    }
    .glass-panel {
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1.25rem 1.35rem;
      margin-bottom: 1.25rem;
      backdrop-filter: blur(14px);
    }
    .glass-panel h2 {
      font-size: 1.2rem;
      font-weight: 600;
      margin: 0 0 1rem;
      padding-bottom: 0.65rem;
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 0.55rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.75rem;
    }
    .stat-box {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.9rem 1rem;
    }
    .stat-box .k { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-box .v { margin-top: 0.35rem; font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .note {
      margin-top: 0.75rem;
      padding: 0.85rem 1rem;
      border-radius: 10px;
      background: rgba(124,92,255,0.15);
      border-left: 4px solid var(--accent);
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.45;
    }
    .note code { font-family: 'JetBrains Mono', monospace; color: #a5f3fc; font-size: 0.82rem; }
    .table-wrap { max-height: 560px; overflow: auto; border-radius: 12px; border: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
    thead { position: sticky; top: 0; z-index: 2; }
    thead th {
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: #fff;
      padding: 0.85rem 0.7rem;
      text-align: right;
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    thead th:nth-child(1), thead th:nth-child(2), thead th:nth-child(3) { text-align: left; }
    tbody td {
      padding: 0.75rem 0.7rem;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      text-align: right;
      background: rgba(15,23,42,0.35);
      font-variant-numeric: tabular-nums;
    }
    tbody td:nth-child(1), tbody td:nth-child(2), tbody td.center { text-align: left; }
    tbody td.center { text-align: center; }
    tbody tr:hover td { background: rgba(124,92,255,0.12); }
    tbody tr.row-failed td { background: rgba(251,113,133,0.12); }
    tbody tr.row-slow td { background: rgba(251,191,36,0.1); }
    tbody tr.totals-row td {
      background: rgba(124,92,255,0.22);
      border-top: 2px solid rgba(255,255,255,0.2);
      font-weight: 700;
    }
    .step-sub { font-size: 0.72rem; color: var(--muted); margin-top: 0.15rem; }
    td.failed { color: var(--bad); font-weight: 700; }
    td.good { color: var(--good); font-weight: 600; }
    .split-tables {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
      margin-bottom: 1.25rem;
    }
    @media (max-width: 1100px) {
      .split-tables { grid-template-columns: 1fr; }
    }
    .split-tables .glass-panel { margin-bottom: 0; }
    .section-hint {
      font-size: 0.82rem;
      color: var(--muted);
      margin: -0.35rem 0 0.85rem;
      line-height: 1.4;
    }
    .chart-box {
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1rem;
      min-height: 340px;
    }
    /* Failed requests (injected after run) */
    .fail-card {
      border: 1px solid rgba(251,113,133,0.35);
      background: rgba(251,113,133,0.08);
      border-radius: 14px;
      padding: 1rem;
      margin-bottom: 0.85rem;
    }
    .fail-card h3 {
      font-size: 0.95rem;
      margin-bottom: 0.65rem;
      display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;
    }
    .pill {
      display: inline-block;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(251,113,133,0.25);
      border: 1px solid rgba(251,113,133,0.4);
    }
    .fail-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 0.4rem 0.85rem;
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 0.65rem;
    }
    .fail-meta b { color: #fff; }
    pre.payload {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      white-space: pre-wrap;
      word-break: break-word;
      background: rgba(0,0,0,0.35);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.75rem;
      max-height: 280px;
      overflow: auto;
      color: #e2e8f0;
      margin-top: 0.35rem;
    }
    .payload-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      margin-top: 0.55rem;
    }
    footer {
      text-align: center;
      padding: 1rem;
      color: var(--muted);
      font-size: 0.8rem;
      border-top: 1px solid var(--border);
    }
    @media (max-width: 768px) {
      body { padding: 0.5rem; }
      header h1 { font-size: 1.25rem; }
      .metric-value { font-size: 1.8rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>
        <i class="fas fa-bolt"></i>
        HRP ${reportKind} Test Report
      </h1>
      <span class="badge ${reportKindLower}"><i class="fas fa-${isSmoke ? "vial" : "gauge-high"}"></i> ${reportKind.toUpperCase()}</span>
    </header>

    <div class="content">
      <div class="meta-grid">
        <div class="meta-item"><b>Report Generated:</b> ${escapeHtml(formatDateTime(reportGeneratedAt))}</div>
        <div class="meta-item"><b>Run ID:</b> ${escapeHtml(runId)}</div>
        <div class="meta-item"><b>Environment / Mode:</b> ${escapeHtml(environmentName)} / ${escapeHtml(mode)}</div>
        <div class="meta-item"><b>Report Type:</b> ${reportKind} Test</div>
        <div class="meta-item"><b>Test Start:</b> ${escapeHtml(formatDateTime(testStart))}</div>
        <div class="meta-item"><b>Test End:</b> ${escapeHtml(formatDateTime(testEnd))}</div>
        <div class="meta-item"><b>Duration:</b> ${escapeHtml(formatDuration(testDurationMs))}</div>
        <div class="meta-item"><b>Max VUs / Iterations:</b> ${vusMax || "—"} / ${iterations}</div>
      </div>

      <div class="metrics-grid">
        <div class="metric-card primary">
          <i class="fas fa-globe icon"></i>
          <h4>Total Requests</h4>
          <div class="metric-value">${flowTotal}</div>
          <div class="metric-subtext">Flow API steps (matches table below)</div>
        </div>
        <div class="metric-card success">
          <i class="fas fa-check-circle icon"></i>
          <h4>Passed Requests</h4>
          <div class="metric-value">${flowPassed}</div>
          <div class="metric-subtext">Flow passed = Total − Failed</div>
        </div>
        <div class="metric-card ${failCardClass}">
          <i class="fas fa-times-circle icon"></i>
          <h4>Failed Requests</h4>
          <div class="metric-value">${flowFailed}</div>
          <div class="metric-subtext">Flow endpoint failures · ${errorPctFlow.toFixed(2)}%</div>
        </div>
        <div class="metric-card ${threshCardClass}">
          <i class="fas fa-exclamation-triangle icon"></i>
          <h4>Breached Thresholds</h4>
          <div class="metric-value">${breachedThresholds}</div>
        </div>
        <div class="metric-card ${checkCardClass}">
          <i class="fas fa-eye icon"></i>
          <h4>Failed Checks</h4>
          <div class="metric-value">${checksOutcome.failed}</div>
          <div class="metric-subtext">Passed checks: ${checksOutcome.passed}</div>
        </div>
        <div class="metric-card warning">
          <i class="fas fa-network-wired icon"></i>
          <h4>All HTTP Requests</h4>
          <div class="metric-value">${allHttp}</div>
          <div class="metric-subtext">Incl. ${helperHttp} helper calls (session lookups) · HTTP fail ${httpFailedInfo.failedRequests} (${errorPctHttp.toFixed(2)}%)</div>
        </div>
      </div>

      <div class="glass-panel">
        <h2><i class="fas fa-chart-line"></i> Performance Summary (k6 accurate)</h2>
        <div class="stats-grid">
          <div class="stat-box"><div class="k">Avg</div><div class="v">${formatSec(avgSec)}</div></div>
          <div class="stat-box"><div class="k">Median</div><div class="v">${formatSec(medSec)}</div></div>
          <div class="stat-box"><div class="k">Min / Max</div><div class="v">${formatSec(minSec)} / ${formatSec(maxSec)}</div></div>
          <div class="stat-box"><div class="k">P90</div><div class="v">${formatSec(p90Sec)}</div></div>
          <div class="stat-box"><div class="k">P95</div><div class="v">${formatSec(p95Sec)}</div></div>
          <div class="stat-box"><div class="k">P99</div><div class="v">${formatSec(p99Sec)}</div></div>
          <div class="stat-box"><div class="k">Throughput</div><div class="v">${throughput.toFixed(2)} req/s</div></div>
          <div class="stat-box"><div class="k">HTTP passed</div><div class="v">${allHttpPassed}</div></div>
        </div>
        <p class="note">
          <b>Accuracy note:</b> <code>Total Requests</code> above uses validated <b>flow</b> APIs (${flowTotal}),
          same as the API Execution Table. Raw k6 <code>http_reqs</code> is ${allHttp}
          because package-session lookups run before the 50-package PATCH.
        </p>
      </div>

      ${corrHtml}

      <div class="split-tables">
        <div class="glass-panel">
          <h2><i class="fas fa-list-ol"></i> Total Requests Summary</h2>
          <p class="section-hint">All flow API steps — totals / passed / failed (k6 <code>endpoint_requests</code>). Matches card: <b>${flowTotal}</b>.</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Endpoint</th><th>Method</th>
                  <th>Total</th><th>Passed</th><th>Failed</th><th>Error %</th>
                </tr>
              </thead>
              <tbody>
                ${totalSummaryRowsHtml || `<tr><td colspan="7" style="text-align:center">No flow endpoint samples</td></tr>`}
                ${totalSummaryRowsHtml ? totalSummaryFooter : ""}
              </tbody>
            </table>
          </div>
        </div>

        <div class="glass-panel">
          <h2><i class="fas fa-triangle-exclamation"></i> Failed Requests Summary</h2>
          <p class="section-hint">Only endpoints that failed — separate from totals for ${reportKindLower} diagnosis. Card failed count: <b>${flowFailed}</b>.</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Endpoint</th><th>Method</th>
                  <th>Total</th><th>Failed</th><th>Error %</th>
                  <th>Avg (s)</th><th>P95</th><th>Max</th>
                </tr>
              </thead>
              <tbody>
                ${
                  failedSummaryRowsHtml
                    ? failedSummaryRowsHtml + failedSummaryFooter
                    : `<tr><td colspan="9" style="text-align:center;color:#34d399">No failed flow requests in this ${reportKindLower} run</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="glass-panel">
        <h2><i class="fas fa-stopwatch"></i> API Latency Table</h2>
        <p class="section-hint">Response-time detail per flow step (Avg / P90 / P95 / P99). Counts repeated for convenience.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Endpoint</th><th>Method</th>
                <th>Avg (s)</th><th>P90</th><th>P95</th><th>P99</th><th>Min</th><th>Max</th>
                <th>Total</th><th>Passed</th><th>Failed</th>
              </tr>
            </thead>
            <tbody>${tableRowsHtml || `<tr><td colspan="12" style="text-align:center">No flow endpoint samples</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      <div class="glass-panel">
        <h2><i class="fas fa-chart-column"></i> Endpoint Comparison</h2>
        <div class="chart-box"><canvas id="endpointComparisonChart"></canvas></div>
      </div>

      <div class="glass-panel" id="hrp-failed-requests-section">
        <h2><i class="fas fa-bug"></i> Error Capture — Failed Requests &amp; Responses</h2>
        <p class="section-hint">Full request/response bodies for every failed call (injected after the k6 run). Use this to identify root cause under load.</p>
        <!--HRP_FAILED_REQUESTS-->
        <p class="note" id="hrp-failed-placeholder">No failed flow requests captured in this run. On failure, full request/response bodies from k6 are injected here after the run.</p>
      </div>
    </div>

    <footer>HRP k6 · ${reportKind} report · generated ${escapeHtml(formatDateTime(reportGeneratedAt))}</footer>
  </div>

  <script>
    const d = ${JSON.stringify(chartData)};
    const ctx = document.getElementById("endpointComparisonChart");
    if (ctx && d.labels && d.labels.length) {
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: d.labels,
          datasets: [
            { label: "Min (s)", data: d.min, backgroundColor: "rgba(52,211,153,0.75)" },
            { label: "Avg (s)", data: d.avg, backgroundColor: "rgba(96,165,250,0.85)" },
            { label: "P95 (s)", data: d.p95, backgroundColor: "rgba(251,146,60,0.85)" },
            { label: "Max (s)", data: d.max, backgroundColor: "rgba(244,114,182,0.75)" },
            { label: "Error %", data: d.errorPct, backgroundColor: "rgba(248,113,113,0.9)", yAxisID: "y1" }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#e2e8f0" } },
            tooltip: {
              callbacks: {
                afterBody: function(items) {
                  const i = items[0] && items[0].dataIndex;
                  if (i == null) return "";
                  return "Requests: " + (d.totals[i] || 0);
                }
              }
            }
          },
          scales: {
            x: { ticks: { color: "#cbd5e1", maxRotation: 55, minRotation: 30 }, grid: { color: "rgba(148,163,184,0.15)" } },
            y: { title: { display: true, text: "Seconds", color: "#cbd5e1" }, ticks: { color: "#cbd5e1" }, grid: { color: "rgba(148,163,184,0.15)" } },
            y1: { position: "right", title: { display: true, text: "Error %", color: "#cbd5e1" }, ticks: { color: "#cbd5e1" }, grid: { drawOnChartArea: false } }
          }
        }
      });
    }
  </script>
</body>
</html>`;
}

export function createHandleSummary(opts) {
  return function handleSummary(data) {
    return {
      "report.html": buildHrpReport(data, opts),
      "summary.json": JSON.stringify(data, null, 2),
      stdout: textSummary(data, { indent: " ", enableColors: true }),
    };
  };
}
