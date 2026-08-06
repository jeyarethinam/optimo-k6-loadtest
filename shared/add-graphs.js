/**
 * Reads k6 --out json=metrics.json output, builds time-series (VU, req/s, avg response, percentiles, error %),
 * and injects a charts section into report.html (Postman-style, professional dashboard).
 *
 * Usage:
 *   node shared/add-graphs.js [targetDir]
 *
 * targetDir: folder containing metrics.json + report.html (default: ./LA28)
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const TARGET_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(REPO_ROOT, "LA28");
const TEST_MODE = process.argv[3] || process.env.TEST_MODE || process.env.K6_TEST_MODE || "";
const METRICS_FILE = path.join(TARGET_DIR, "metrics.json");
const REPORT_FILES = [
  path.join(TARGET_DIR, "report.html"),
  path.join(TARGET_DIR, "K6-report-Load-100VU.html"),
];
const BUCKET_SEC = 1;

function percentile(sortedArr, p) {
  if (!sortedArr || sortedArr.length === 0) return null;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return Math.round(sortedArr[lo]);
  return Math.round(sortedArr[lo] + (idx - lo) * (sortedArr[hi] - sortedArr[lo]));
}

function minTimestamp(points) {
  let tMin = Infinity;
  for (const key of ["vus", "http_reqs", "http_req_duration", "http_req_failed"]) {
    for (const { t } of points[key]) {
      if (t < tMin) tMin = t;
    }
  }
  return tMin === Infinity ? 0 : tMin;
}

function loadPoints(metricsPath) {
  if (!fs.existsSync(metricsPath)) return null;
  const text = fs.readFileSync(metricsPath, "utf8");
  const points = { vus: [], http_reqs: [], http_req_duration: [], http_req_failed: [] };
  const metricNames = new Set(Object.keys(points));
  text.split("\n").forEach((line) => {
    line = line.trim();
    if (!line) return;
    try {
      const row = JSON.parse(line);
      if (row.type !== "Point" || !metricNames.has(row.metric)) return;
      const t = new Date(row.data.time).getTime();
      const v = row.data.value;
      points[row.metric].push({ t, v });
    } catch (_) {}
  });
  return points;
}

function bucketSeries(points) {
  if (!points || points.http_reqs.length === 0) return null;
  const tMin = minTimestamp(points);
  const buckets = new Map();

  function bucketKey(t) {
    return Math.floor((t - tMin) / (BUCKET_SEC * 1000)) * (BUCKET_SEC * 1000) + tMin;
  }

  points.vus.forEach(({ t, v }) => {
    const k = bucketKey(t);
    if (!buckets.has(k)) buckets.set(k, { t: k, vus: [], reqs: 0, durations: [], failedSum: 0 });
    buckets.get(k).vus.push(v);
  });
  points.http_reqs.forEach(({ t }) => {
    const k = bucketKey(t);
    if (!buckets.has(k)) buckets.set(k, { t: k, vus: [], reqs: 0, durations: [], failedSum: 0 });
    buckets.get(k).reqs += 1;
  });
  points.http_req_duration.forEach(({ t, v }) => {
    const k = bucketKey(t);
    if (!buckets.has(k)) buckets.set(k, { t: k, vus: [], reqs: 0, durations: [], failedSum: 0 });
    buckets.get(k).durations.push(v);
  });
  points.http_req_failed.forEach(({ t, v }) => {
    const k = bucketKey(t);
    if (!buckets.has(k)) buckets.set(k, { t: k, vus: [], reqs: 0, durations: [], failedSum: 0 });
    buckets.get(k).failedSum += v;
  });

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const labels = [];
  const vusData = [];
  const reqPerSecData = [];
  const avgResponseData = [];
  const requestTimeData = []; // median
  const p90Data = [];
  const p95Data = [];
  const p99Data = [];
  const errorPctData = [];

  keys.forEach((k) => {
    const b = buckets.get(k);
    const date = new Date(b.t);
    labels.push(date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    vusData.push(b.vus.length ? Math.round(b.vus[b.vus.length - 1]) : null);
    reqPerSecData.push(b.reqs);
    let avgMs = null;
    let medMs = null;
    let p90 = null, p95 = null, p99 = null;
    if (b.durations.length > 0) {
      const sorted = [...b.durations].sort((a, b) => a - b);
      avgMs = Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length);
      medMs = percentile(sorted, 50);
      p90 = percentile(sorted, 90);
      p95 = percentile(sorted, 95);
      p99 = percentile(sorted, 99);
    }
    avgResponseData.push(avgMs);
    requestTimeData.push(medMs);
    p90Data.push(p90);
    p95Data.push(p95);
    p99Data.push(p99);
    errorPctData.push(b.reqs > 0 ? Math.round((b.failedSum / b.reqs) * 1000) / 10 : 0);
  });

  return {
    labels,
    vusData,
    reqPerSecData,
    avgResponseData,
    requestTimeData,
    p90Data,
    p95Data,
    p99Data,
    errorPctData,
    tMin,
    tMax: keys.length ? keys[keys.length - 1] : tMin
  };
}

function computeSummary(series, points) {
  const allDurations = (points && points.http_req_duration) ? points.http_req_duration.map((p) => p.v) : [];
  const totalReqs = (points && points.http_reqs) ? points.http_reqs.length : 0;
  const totalFailed = (points && points.http_req_failed) ? points.http_req_failed.reduce((s, p) => s + p.v, 0) : 0;
  const sorted = allDurations.length ? [...allDurations].sort((a, b) => a - b) : [];
  const minMs = sorted.length ? Math.round(sorted[0]) : 0;
  const maxMs = sorted.length ? Math.round(sorted[sorted.length - 1]) : 0;
  const avgMs = sorted.length ? Math.round(sorted.reduce((s, x) => s + x, 0) / sorted.length) : 0;
  const errPct = totalReqs > 0 ? Math.round((totalFailed / totalReqs) * 1000) / 10 : 0;
  const durationSec = series && series.tMax && series.tMin ? (series.tMax - series.tMin) / 1000 : 0;
  const durationStr = durationSec >= 60 ? (durationSec / 60).toFixed(1) + " min" : durationSec.toFixed(1) + " s";
  const maxVus = series && Array.isArray(series.vusData) && series.vusData.length
    ? series.vusData.reduce((m, x) => (typeof x === "number" && Number.isFinite(x) && x > m ? x : m), 0)
    : 0;
  return { minMs, maxMs, avgMs, errPct, totalReqs, durationStr, durationSec, maxVus };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatRunStamp(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}_${pad2(dt.getHours())}${pad2(dt.getMinutes())}${pad2(dt.getSeconds())}`;
}

function safeSlug(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function writeTimestampedReportCopy(targetDir, summary, mode, primaryReportPath) {
  if (!primaryReportPath || !fs.existsSync(primaryReportPath)) return null;
  const stamp = formatRunStamp(new Date());
  const vu = summary && Number.isFinite(summary.maxVus) ? Math.max(0, Math.round(summary.maxVus)) : 0;
  const dur = summary && Number.isFinite(summary.durationSec) ? Math.max(0, Math.round(summary.durationSec)) : 0;
  const modeSlug = safeSlug(mode);
  const parts = ["report", stamp];
  if (modeSlug) parts.push(modeSlug);
  if (vu) parts.push(`${vu}VU`);
  if (dur) parts.push(`${dur}s`);
  const fileName = parts.join("_") + ".html";
  const outPath = path.join(targetDir, fileName);
  fs.copyFileSync(primaryReportPath, outPath);
  return fileName;
}

function buildChartsSection(series, summary) {
  const data = JSON.stringify({
    labels: series.labels,
    vus: series.vusData,
    reqPerSec: series.reqPerSecData,
    avgResponseMs: series.avgResponseData,
    requestTimeMs: series.requestTimeData,
    p90: series.p90Data,
    p95: series.p95Data,
    p99: series.p99Data,
    errorPct: series.errorPctData
  });
  const sumJson = JSON.stringify(summary).replace(/</g, "\\u003c");
  return `
<div style="margin-top:48px;padding:28px;background:#fafbfc;border-radius:12px;border:1px solid #e8ecf0;">
  <h2 style="margin:0 0 8px 0;color:#1e293b;font-size:1.5rem;font-weight:600;">Performance over time</h2>
  <p style="color:#64748b;margin-bottom:28px;font-size:0.9rem;">Response time and throughput trends during the test. Postman-style dashboard with percentiles and error highlighting.</p>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px;">
    <div style="padding:14px 18px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Min Response Time</div>
      <div style="font-size:1.25rem;font-weight:700;color:#0f172a;margin-top:4px;" id="indMinMs">${summary.minMs}</div>
      <div style="font-size:0.75rem;color:#94a3b8;">ms</div>
    </div>
    <div style="padding:14px 18px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Max Response Time</div>
      <div style="font-size:1.25rem;font-weight:700;color:#0f172a;margin-top:4px;" id="indMaxMs">${summary.maxMs}</div>
      <div style="font-size:0.75rem;color:#94a3b8;">ms</div>
    </div>
    <div style="padding:14px 18px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Avg Response Time</div>
      <div style="font-size:1.25rem;font-weight:700;color:#0f172a;margin-top:4px;" id="indAvgMs">${summary.avgMs}</div>
      <div style="font-size:0.75rem;color:#94a3b8;">ms</div>
    </div>
    <div style="padding:14px 18px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Error %</div>
      <div style="font-size:1.25rem;font-weight:700;color:${summary.errPct > 0 ? "#b91c1c" : "#0f172a"};margin-top:4px;" id="indErrPct">${summary.errPct}</div>
      <div style="font-size:0.75rem;color:#94a3b8;">%</div>
    </div>
    <div style="padding:14px 18px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Total Requests</div>
      <div style="font-size:1.25rem;font-weight:700;color:#0f172a;margin-top:4px;" id="indTotalReqs">${summary.totalReqs}</div>
    </div>
    <div style="padding:14px 18px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
      <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;">Test Duration</div>
      <div style="font-size:1.25rem;font-weight:700;color:#0f172a;margin-top:4px;" id="indDuration">${summary.durationStr}</div>
    </div>
  </div>

  <div style="margin-bottom:32px;">
    <h3 style="margin:0 0 8px 0;color:#334155;font-size:1.05rem;font-weight:600;">1.1 Response time</h3>
    <p style="color:#64748b;margin-bottom:14px;font-size:0.85rem;">Avg, Request time (median), P90/P95/P99 and latency spread. Virtual users as background.</p>
    <div style="position:relative;height:360px;background:#f8fafc;border-radius:10px;padding:20px;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05);">
      <canvas id="perfChartResponse"></canvas>
    </div>
  </div>

  <div>
    <h3 style="margin:0 0 8px 0;color:#334155;font-size:1.05rem;font-weight:600;">1.2 Throughput & errors</h3>
    <p style="color:#64748b;margin-bottom:14px;font-size:0.85rem;">Requests/sec, error %, and virtual users. Error spikes highlighted.</p>
    <div style="position:relative;height:320px;background:#f8fafc;border-radius:10px;padding:20px;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.05);">
      <canvas id="perfChartThroughput"></canvas>
    </div>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
(function() {
  var s = ${data.replace(/</g, "\\u003c")};
  var summary = ${sumJson};

  var gridColor = "rgba(148,163,184,0.2)";
  var tooltipOpts = {
    padding: 12,
    titleFont: { size: 12, weight: "600" },
    bodyFont: { size: 12 },
    bodySpacing: 6,
    displayColors: true,
    boxPadding: 4,
    callbacks: {
      label: function(ctx) {
        var v = ctx.parsed.y;
        if (v == null) return null;
        var label = ctx.dataset.label || "";
        if (label.indexOf("response") !== -1 || label.indexOf("Request") !== -1 || label.indexOf("P90") !== -1 || label.indexOf("P95") !== -1 || label.indexOf("P99") !== -1) return label + ": " + v + " ms";
        if (label === "Error %") return label + ": " + v + "%";
        if (label === "Virtual users") return label + ": " + Math.round(v);
        if (label === "Requests/sec") return label + ": " + v;
        return label + ": " + v;
      }
    }
  };

  var respCtx = document.getElementById("perfChartResponse");
  if (respCtx) {
    var respData = {
      labels: s.labels,
      datasets: [
        { label: "Virtual users", data: s.vus, borderColor: "rgba(100,116,139,0.45)", backgroundColor: "rgba(148,163,184,0.1)", fill: true, yAxisID: "yVU", tension: 0.4, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, order: 0 },
        { label: "P90", data: s.p90, borderColor: "rgba(139,92,246,0.85)", backgroundColor: "transparent", fill: false, yAxisID: "yMs", tension: 0.4, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, order: 1 },
        { label: "P99", data: s.p99, borderColor: "rgba(124,58,237,0.75)", backgroundColor: "rgba(139,92,246,0.1)", fill: "-1", yAxisID: "yMs", tension: 0.4, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, order: 2 },
        { label: "P95", data: s.p95, borderColor: "rgba(167,139,250,0.95)", backgroundColor: "transparent", fill: false, yAxisID: "yMs", tension: 0.4, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, order: 3 },
        { label: "Avg. response time", data: s.avgResponseMs, borderColor: "#6366f1", backgroundColor: "transparent", fill: false, yAxisID: "yMs", tension: 0.4, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 5, order: 4 },
        { label: "Request time (median)", data: s.requestTimeMs, borderColor: "#818cf8", backgroundColor: "transparent", fill: false, yAxisID: "yMs", tension: 0.4, borderWidth: 1, borderDash: [4,3], pointRadius: 0, pointHoverRadius: 4, order: 5 }
      ]
    };
    new Chart(respCtx.getContext("2d"), {
      type: "line",
      data: respData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { padding: 16, usePointStyle: true, pointStyle: "circle", font: { size: 11 } } },
          tooltip: tooltipOpts
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 14, font: { size: 10 } } },
          yVU: { type: "linear", position: "left", title: { display: true, text: "VU" }, min: 0, grid: { color: gridColor }, ticks: { font: { size: 10 } } },
          yMs: { type: "linear", position: "right", title: { display: true, text: "ms" }, min: 0, grid: { color: gridColor }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  var thruCtx = document.getElementById("perfChartThroughput");
  if (thruCtx) {
    var errorPctMax = s.errorPct.length ? Math.max.apply(null, s.errorPct) : 0;
    var yPctMax = errorPctMax <= 0 ? 10 : Math.min(100, Math.max(10, Math.ceil(errorPctMax * 1.5)));
    var errPointRadius = s.errorPct.map(function(v) { return v > 0 ? 4 : 0; });
    var thruData = {
      labels: s.labels,
      datasets: [
        { label: "Virtual users", data: s.vus, borderColor: "rgba(100,116,139,0.5)", backgroundColor: "rgba(148,163,184,0.12)", fill: true, yAxisID: "yVU", tension: 0.4, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, order: 0 },
        { label: "Requests/sec", data: s.reqPerSec, borderColor: "#3b82f6", backgroundColor: "transparent", fill: false, yAxisID: "yReq", tension: 0.4, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, order: 1 },
        { label: "Error %", data: s.errorPct, borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,0.08)", fill: true, yAxisID: "yPct", tension: 0.4, borderWidth: 1, pointRadius: errPointRadius, pointHoverRadius: 6, pointBackgroundColor: "#dc2626", order: 2 }
      ]
    };
    new Chart(thruCtx.getContext("2d"), {
      type: "line",
      data: thruData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { padding: 16, usePointStyle: true, pointStyle: "circle", font: { size: 11 } } },
          tooltip: tooltipOpts
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { maxTicksLimit: 14, font: { size: 10 } } },
          yVU: { type: "linear", position: "left", title: { display: true, text: "VU" }, min: 0, grid: { color: gridColor }, ticks: { font: { size: 10 } } },
          yReq: { type: "linear", position: "right", title: { display: true, text: "req/s" }, min: 0, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } },
          yPct: { type: "linear", position: "right", title: { display: true, text: "Error %" }, min: 0, max: yPctMax, grid: { drawOnChartArea: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

})();
</script>
`;
}

function injectChartsIntoReport(reportPath, chartsHtml) {
  if (!fs.existsSync(reportPath)) return false;
  let html = fs.readFileSync(reportPath, "utf8");
  const marker = "</body>";
  if (!html.includes(marker)) return false;
  // Prevent duplicate chart blocks when add-graphs.js is run multiple times.
  html = html.replace(/<div style="margin-top:48px;padding:28px;background:#fafbfc;border-radius:12px;border:1px solid #e8ecf0;">[\s\S]*?<\/script>\s*/g, "");
  // Backward-compat cleanup: remove old injected "classic" duplicate chart panel if present.
  html = html.replace(/<div style="margin-top:20px;padding:28px;background:#ffffff;border-radius:12px;border:1px solid #e8ecf0;">[\s\S]*?<canvas id="perfChartThroughputClassic"><\/canvas>[\s\S]*?<\/div>\s*/g, "");
  html = html.replace(marker, chartsHtml + "\n" + marker);
  fs.writeFileSync(reportPath, html, "utf8");
  return true;
}

function main() {
  const points = loadPoints(METRICS_FILE);
  const series = points ? bucketSeries(points) : null;
  if (!series || series.labels.length === 0) {
    console.log("No metrics.json or no data points in", TARGET_DIR);
    console.log("Run k6 with cwd = that folder, e.g.: cd LA28 && k6 run --out json=metrics.json script.js -e TEST_MODE=smoke");
    process.exitCode = 1;
    return;
  }
  const summary = computeSummary(series, points);
  const chartsHtml = buildChartsSection(series, summary);
  const updated = [];
  for (const file of REPORT_FILES) {
    if (injectChartsIntoReport(file, chartsHtml)) {
      updated.push(path.basename(file));
    }
  }
  if (updated.length > 0) {
    console.log(`Charts (VU, req/s, avg/percentiles, error %, performance indicators) added to: ${updated.join(", ")}.`);
    // HRP (and others) can archive after failure injection via SKIP_TIMESTAMPED_REPORT_COPY=1
    if (process.env.SKIP_TIMESTAMPED_REPORT_COPY !== "1") {
      const primary = path.join(TARGET_DIR, "report.html");
      const stamped = writeTimestampedReportCopy(TARGET_DIR, summary, TEST_MODE, primary);
      if (stamped) {
        console.log(`Timestamped report copy created: ${stamped}`);
      }
    }
  } else {
    console.log("No supported report file found for chart injection.");
    process.exitCode = 1;
  }
}

main();
