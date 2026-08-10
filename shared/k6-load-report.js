/**
 * WCC-only HTML report: teal hero banner, booking-model sub-tables (login / simple / complex), ECOM-style metrics.
 * ECOM uses its own template in ECOM/script.js — do not import this module from ECOM.
 */

function readMetricValue(data, metricName, field, fallback = 0) {
  const v = data?.metrics?.[metricName]?.values?.[field];
  return typeof v === "number" ? v : fallback;
}

/**
 * k6 `checks` Rate: `passes` = successful check evaluations, `fails` = failed evaluations (names are easy to swap mentally).
 */
function readChecksOutcome(data) {
  const v = data?.metrics?.checks?.values || {};
  return {
    passed: typeof v.passes === "number" ? v.passes : 0,
    failed: typeof v.fails === "number" ? v.fails : 0,
  };
}

/** k6 Counter end-of-test summary uses `values.count` only (not `passes` / `fails`). */
function readCounterSum(values) {
  if (!values || typeof values !== "object") return 0;
  const c = values.count;
  return typeof c === "number" && !Number.isNaN(c) ? c : 0;
}

/**
 * k6 `http_req_failed` is a Rate: each request adds 0 (success) or 1 (failure). In the summary JSON,
 * `values.passes` counts failure samples (non-zero / “true”), and `values.fails` counts successes — naming is easy to misread.
 * `values.rate` is failed/total. Prefer `passes` when present; else derive from `http_reqs` × rate.
 * @see https://grafana.com/docs/k6/latest/using-k6/metrics/reference/#http_req_failed
 */
function readHttpFailedRequestCount(data, fallbackRate = 0) {
  const m = data?.metrics?.http_req_failed;
  const values = m?.values || {};
  const rate = typeof values.rate === "number" ? values.rate : fallbackRate;
  const totalReqs = readMetricValue(data, "http_reqs", "count", 0);
  if (typeof values.passes === "number") {
    return { rate, failedRequests: values.passes };
  }
  if (totalReqs > 0 && typeof rate === "number") {
    return { rate, failedRequests: Math.round(totalReqs * rate) };
  }
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

function buildEndpointRows(data, flowStepOrder, getStepMeta) {
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
    const durationValues = mergeDurationValuesForStep(durEntries);
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
  const simpleClientId = readGaugeValue(data, "smoke_client_id");
  const simpleContactId = readGaugeValue(data, "smoke_contact_id");
  const simpleBookingId = readGaugeValue(data, "smoke_booking_id");
  const complexContactId = readGaugeValue(data, "smoke_complex_contact_id");
  const complexBookingId = readGaugeValue(data, "smoke_complex_booking_id");

  const hasAny = Boolean(
    simpleClientId || simpleBookingId || simpleContactId || complexBookingId || complexContactId
  );

  if (!hasAny) {
    return `
  <div class="section">
    <h2>Correlation IDs</h2>
    <p style="margin:0;color:#64748b;font-size:13px">No correlation IDs were recorded (gauge metrics missing).</p>
  </div>
`;
  }

  const dash = (v) => (v ? escapeHtml(v) : "—");

  return `
  <div class="section">
    <h2>Correlation IDs (smoke — by booking type)</h2>
    <table>
      <thead>
        <tr>
          <th>Booking type</th>
          <th>clientId</th>
          <th>contactId</th>
          <th>bookingId</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Simple (day package)</td>
          <td>${dash(simpleClientId)}</td>
          <td>${dash(simpleContactId)}</td>
          <td>${dash(simpleBookingId)}</td>
        </tr>
        <tr>
          <td>Complex (recurring)</td>
          <td>—</td>
          <td>${dash(complexContactId)}</td>
          <td>${dash(complexBookingId)}</td>
        </tr>
      </tbody>
    </table>
    <p style="margin:10px 0 0;color:#64748b;font-size:12px">VU 1 smoke: simple row comes from the corporate client create path; complex row uses the shared contact on the booking (<code>WCC_SHARED_CONTACT_ID</code>) plus the recurring booking id. Unused cells show —.</p>
  </div>
`;
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

function partitionWccEndpointRows(rows) {
  const simple = [];
  const complex = [];
  for (const r of rows) {
    if (String(r.step).startsWith("WCC_Simple_")) simple.push(r);
    else if (String(r.step).startsWith("WCC_Complex_")) complex.push(r);
  }
  return { simple, complex };
}

function formatEndpointTableRows(rows) {
  return rows.map((r, i) => {
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
}

function wccApiSubsection(title, hint, rows) {
  if (!rows.length) {
    return `<div class="wcc-subsection"><h3>${title}</h3><p class="wcc-empty">No samples for this group in this run (${hint}).</p></div>`;
  }
  return `<div class="wcc-subsection">
    <h3>${title}</h3>
    <p class="wcc-hint">${hint}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Endpoint Name</th><th>Method</th><th>Avg</th><th>P95</th><th>P99</th><th>Min</th><th>Max</th><th>Total</th><th>Passed</th><th>Failed</th>
          </tr>
        </thead>
        <tbody>${formatEndpointTableRows(rows)}</tbody>
      </table>
    </div>
  </div>`;
}

/**
 * @param {object} data - k6 handleSummary data
 * @param {object} opts
 * @param {string[]} opts.flowStepOrder - ordered flow_step tags for the API table
 * @param {(step: string) => { endpoint: string, method: string }} opts.getStepMeta - fallback labels per step
 * @param {string} opts.mode - TEST_MODE label
 * @param {string} opts.environmentName - ENV_NAME / ENV display
 * @param {object} [opts.wccReport] - WCC hero copy + base URL for hero banner
 * @param {string} [opts.wccReport.heroSubtitle] - Short human-readable line under the title
 * @param {string} [opts.wccReport.technicalAppendix] - Optional collapsible technical notes
 * @param {string} [opts.wccReport.scenarioLine] - Legacy; used if heroSubtitle missing
 * @param {string} [opts.wccReport.dateStrategyLine] - Legacy; folded into appendix if technicalAppendix missing
 * @param {string} opts.wccReport.baseUrl
 * @param {string} opts.wccReport.flow
 * @param {boolean} opts.wccReport.isSmoke
 */
export function buildCustomReport(data, opts) {
  const {
    flowStepOrder,
    getStepMeta,
    mode,
    environmentName,
    wccReport: wccMeta,
  } = opts;

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
  const endpointRows = buildEndpointRows(data, flowStepOrder, getStepMeta);
  const testDurationSec = Math.max(testDurationMs / 1000, 1);

  const { simple: simpleRows, complex: complexRows } = partitionWccEndpointRows(endpointRows);
  const apiSectionsHtml = `
    ${wccApiSubsection(
    "Simple · Day-package booking",
    "Includes login + single-day package flow: anchor date (default May 2026) + per-VU offset so each VU uses a different calendar day.",
    simpleRows
  )}
    ${wccApiSubsection(
    "Complex · Recurring diary booking",
    "2029 multi-day recurrence window + shared contact; under mixed load this section reflects ~20% of VUs.",
    complexRows
  )}
  `;

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

  const wcc = wccMeta || {};
  const heroSubtitle = escapeHtml(
    wcc.heroSubtitle || wcc.scenarioLine || "WCC performance run — see metrics below for details."
  );
  const baseUrlLine = escapeHtml(wcc.baseUrl || "");
  const flowLine = escapeHtml(wcc.flow || "both");
  const envLine = escapeHtml(environmentName || "N/A");
  const runKindLabel = wcc.isSmoke ? "Smoke" : "Load / peak";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WCC · k6 Performance Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body.wcc-report { font-family: "Segoe UI", system-ui, Arial, sans-serif; margin: 0; padding: 24px; background: linear-gradient(180deg,#ecfdf5 0%,#f8fafc 35%,#f1f5f9 100%); color: #0f172a; }
    h1,h2,h3 { margin: 0 0 10px 0; }
    .wcc-hero { background: linear-gradient(135deg,#0f766e 0%,#14b8a6 38%,#0f766e 100%); color: #ecfdf5; padding: 28px 32px; border-radius: 16px; margin-bottom: 22px; box-shadow: 0 12px 40px rgba(15,118,110,0.28); border: 1px solid rgba(240,253,250,0.35); }
    .wcc-hero-kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.92; margin-bottom: 10px; color: #ccfbf1; }
    .wcc-hero h1 { font-size: 1.85rem; font-weight: 800; color: #fff; margin: 0 0 14px 0; letter-spacing: -0.02em; text-shadow: 0 1px 2px rgba(0,0,0,0.12); }
    .wcc-hero-lead { font-size: 16px; line-height: 1.6; margin: 0 0 4px 0; max-width: 760px; color: #f0fdfa; font-weight: 500; }
    .wcc-hero-meta { display: flex; flex-wrap: wrap; gap: 10px 12px; font-size: 12px; border-top: 1px solid rgba(240,253,250,0.28); padding-top: 16px; margin-top: 18px; }
    .wcc-hero-pill { background: rgba(15,23,42,0.22); backdrop-filter: blur(6px); padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(240,253,250,0.2); }
    .wcc-hero-pill b { font-weight: 700; color: #fff; }
    .wcc-appendix summary { cursor: pointer; font-weight: 600; color: #0f766e; }
    .wcc-appendix-body { margin: 12px 0 0; font-size: 13px; line-height: 1.55; color: #475569; max-width: 960px; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(180px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(220px, 1fr)); gap: 10px; margin: 8px 0 16px 0; }
    .meta-item { background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:12px 14px; font-size:13px; color:#0f172a; box-shadow:0 1px 2px rgba(15,23,42,0.06); }
    .meta-item b { color:#0f766e; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:4px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .label { font-size: 12px; color: #64748b; text-transform: uppercase; }
    .value { font-size: 24px; font-weight: 700; margin-top: 6px; color: #0f766e; }
    .section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .wcc-subsection { margin-bottom: 22px; }
    .wcc-subsection:last-child { margin-bottom: 0; }
    .wcc-hint { margin: 0 0 10px 0; color:#475569; font-size:13px; line-height:1.45; }
    .wcc-empty { margin: 0; color:#94a3b8; font-size: 13px; font-style: italic; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: right; }
    .row-failed td { background: #fff1f2; }
    .row-slow td { background: #fff7ed; }
    .row-failed-slow td { background: #fee2e2; }
    th:nth-child(2), td:nth-child(2) { text-align: left; }
    th:nth-child(3), td:nth-child(3) { text-align: center; }
    th { background: #134e4a; color: #fff; position: sticky; top: 0; }
    .table-wrap { max-height: 420px; overflow: auto; border-radius: 8px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap: 10px; }
    .mini { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
    .mini .k { font-size: 12px; color: #64748b; }
    .mini .v { font-size: 18px; margin-top: 6px; font-weight: 700; color: #0f766e; }
    .chart-box { margin-top: 12px; }
    canvas { width: 100% !important; max-height: 350px; }
  </style>
</head>
<body class="wcc-report">
  <div class="wcc-hero">
    <div class="wcc-hero-kicker">WCC · ${envLine}</div>
    <h1>Performance report</h1>
    <p class="wcc-hero-lead">${heroSubtitle}</p>
    <div class="wcc-hero-meta">
      <span class="wcc-hero-pill"><b>Run type</b> · ${runKindLabel}</span>
      <span class="wcc-hero-pill"><b>Flow</b> · ${flowLine}</span>
      <span class="wcc-hero-pill"><b>k6 mode</b> · ${escapeHtml(mode)}</span>
      <span class="wcc-hero-pill"><b>API</b> · ${baseUrlLine}</span>
    </div>
  </div>
  <div class="meta">
    <div class="meta-item"><b>Report generated</b> ${formatDateTime(reportGeneratedAt)}</div>
    <div class="meta-item"><b>Run ID</b> ${runId}</div>
    <div class="meta-item"><b>Environment / mode</b> ${envLine} / ${escapeHtml(mode)}</div>
    <div class="meta-item"><b>Test start</b> ${formatDateTime(testStart)}</div>
    <div class="meta-item"><b>Test end</b> ${formatDateTime(testEnd)}</div>
    <div class="meta-item"><b>Total duration</b> ${formatDuration(testDurationMs)}</div>
  </div>
  <div class="cards">
    <div class="card"><div class="label">Total Requests</div><div class="value">${totalRequests}</div></div>
    <div class="card"><div class="label">Passed Requests</div><div class="value">${passedRequests}</div></div>
    <div class="card"><div class="label">Failed Requests</div><div class="value">${failedInfo.failedRequests}</div></div>
    <div class="card"><div class="label">Breached Thresholds</div><div class="value">${breachedThresholds}</div></div>
    <div class="card"><div class="label">Passed Checks</div><div class="value">${passedChecks}</div></div>
    <div class="card"><div class="label">Failed Checks</div><div class="value">${failedChecks}</div></div>
  </div>

  ${correlationIdsSectionHtml}

  <div class="section">
    <h2>Performance summary</h2>
    <p style="margin:0 0 12px 0;color:#64748b;font-size:13px;line-height:1.5">HTTP timing and throughput from k6 (run timing and request totals are in the cards above).</p>
    <div class="summary-grid">
      <div class="mini"><div class="k">Avg response time</div><div class="v">${formatSec(avgSec)}</div></div>
      <div class="mini"><div class="k">Min response time</div><div class="v">${formatSec(minSec)}</div></div>
      <div class="mini"><div class="k">Max response time</div><div class="v">${formatSec(maxSec)}</div></div>
      <div class="mini"><div class="k">P95</div><div class="v">${formatSec(p95Sec)}</div></div>
      <div class="mini"><div class="k">P99</div><div class="v">${formatSec(p99Sec)}</div></div>
      <div class="mini"><div class="k">Throughput</div><div class="v">${throughput.toFixed(2)} req/s</div></div>
      <div class="mini"><div class="k">Error %</div><div class="v">${errorPct.toFixed(2)}%</div></div>
    </div>
  </div>

  <div class="section">
    <h2>API execution by booking model</h2>
    <p style="margin:0 0 16px 0;color:#475569;font-size:14px;line-height:1.5">Endpoints grouped by booking model: simple (with login) and complex recurring flow. Under mixed load, request counts reflect the 80% / 20% VU split. Table columns: <strong>Total</strong> / <strong>Passed</strong> / <strong>Failed</strong> come from k6 counters <code>endpoint_requests</code> and <code>endpoint_failures</code> per flow step (Passed = Total − Failed).</p>
    ${apiSectionsHtml}
  </div>

  <div class="section">
    <h2>Endpoint comparison (all steps)</h2>
    <p style="margin:0 0 10px 0;color:#475569;font-size:13px">Min, Avg, P95, Max (seconds) and error % — all flow steps in execution order.</p>
    <div class="chart-box"><canvas id="endpointComparisonChart"></canvas></div>
  </div>

  <script>
    const d = ${JSON.stringify(chartData)};
    const colors = {
      avg: "#0d9488", p90: "#6366f1", p95: "#ea580c", p99: "#dc2626", min: "#059669", max: "#b45309", err: "#ef4444", throughput: "#14b8a6"
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
          x: { ticks: { maxRotation: 70, minRotation: 70, autoSkip: false }, title: { display: true, text: "Flow steps" } },
          y: { title: { display: true, text: "Seconds" } },
          y1: { position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Error %" } }
        }
      }
    });
  </script>
</body>
</html>`;
}
