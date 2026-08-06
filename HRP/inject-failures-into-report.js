/**
 * Inject failed-requests.json into HRP/report.html Error Capture section.
 * Called by run-load-test.js after extract-failures.js.
 */
const fs = require("fs");
const path = require("path");

const HRP_DIR = __dirname;
const REPORT = path.join(HRP_DIR, "report.html");
const FAILURES = path.join(HRP_DIR, "failed-requests.json");
const MARKER = "<!--HRP_FAILED_REQUESTS-->";

function escapeHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function prettyBody(v) {
  if (v == null || v === "") return "(empty)";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function buildFailuresHtml(failures) {
  if (!failures.length) {
    return `<p class="note">No failed requests captured in this run. All flow API calls succeeded.</p>`;
  }

  const cards = failures
    .map((f, i) => {
      const status = f.status ?? "";
      const endpoint = f.endpoint || f.flowStep || "Unknown";
      return `<div class="fail-card">
  <h3>
    <span class="pill">#${i + 1}</span>
    <span>${escapeHtml(endpoint)}</span>
    <span class="pill">HTTP ${escapeHtml(status)}</span>
  </h3>
  <div class="fail-meta">
    <div><b>Time:</b> ${escapeHtml(f.requestTime || "—")}</div>
    <div><b>Method:</b> ${escapeHtml(f.method || "—")}</div>
    <div><b>Flow step:</b> ${escapeHtml(f.flowStep || "—")}</div>
    <div><b>Duration:</b> ${f.responseTimeMs != null ? escapeHtml(f.responseTimeMs) + " ms" : "—"}</div>
    <div><b>bookingId:</b> ${escapeHtml(f.bookingId ?? "—")}</div>
    <div><b>packageId:</b> ${escapeHtml(f.packageId ?? "—")}</div>
    <div><b>contactId:</b> ${escapeHtml(f.contactId ?? "—")}</div>
    <div><b>Network:</b> ${escapeHtml(f.networkError || f.networkErrorCode || "—")}</div>
  </div>
  <div><b>URL</b></div>
  <pre class="payload">${escapeHtml(f.url || "")}</pre>
  <div class="payload-label">Request body</div>
  <pre class="payload">${escapeHtml(prettyBody(f.requestBody))}</pre>
  <div class="payload-label">Response body</div>
  <pre class="payload">${escapeHtml(prettyBody(f.responseBody))}</pre>
</div>`;
    })
    .join("\n");

  return `<p class="note"><b>${failures.length}</b> failed request(s) captured from k6 run log (full request + response for issue diagnosis).</p>
${cards}`;
}

function main() {
  if (!fs.existsSync(REPORT)) {
    console.error("report.html not found:", REPORT);
    return 1;
  }

  let failures = [];
  if (fs.existsSync(FAILURES)) {
    try {
      const raw = JSON.parse(fs.readFileSync(FAILURES, "utf8"));
      failures = Array.isArray(raw) ? raw : [];
    } catch (e) {
      console.error("Could not parse failed-requests.json:", e.message || e);
    }
  }

  let html = fs.readFileSync(REPORT, "utf8");
  if (!html.includes(MARKER)) {
    console.error("Report marker not found; skip inject.");
    return 1;
  }

  const section = buildFailuresHtml(failures);
  html = html.replace(MARKER, MARKER + "\n" + section);
  // Remove the empty-state placeholder when we injected real content (or success note).
  html = html.replace(
    /<p class="note" id="hrp-failed-placeholder">[\s\S]*?<\/p>/,
    ""
  );

  fs.writeFileSync(REPORT, html, "utf8");
  console.log(
    failures.length
      ? `Injected ${failures.length} failed request(s) into report.html Error Capture section.`
      : "Error Capture section updated (no failures)."
  );
  return 0;
}

process.exit(main());
