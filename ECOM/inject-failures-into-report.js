/**
 * Inject failed-requests.json into ECOM report Error Capture section.
 * Called by run-load-test.js after extract-failures.js.
 *
 * Supports both shapes from extract-failures.js:
 *   - { generatedAt, totalFailedRequests, failures: [...] }
 *   - [ ... ]  (legacy array)
 */
const fs = require("fs");
const path = require("path");

const ECOM_DIR = __dirname;
const REPORT = path.join(ECOM_DIR, "report.html");
const FAILURES = path.join(ECOM_DIR, "failed-requests.json");
const LAST_REPORT = path.join(ECOM_DIR, ".ecom-last-report");
const MARKER = "<!--ECOM_FAILED_REQUESTS-->";

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

function readFailuresList(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.failures)) return raw.failures;
    return [];
  } catch (e) {
    console.error("Could not parse failed-requests.json:", e.message || e);
    return [];
  }
}

function buildFailuresHtml(failures) {
  if (!failures.length) {
    return `<p class="note">No failed requests captured in this run (no non-2xx / network failures in <code>k6-run.log</code>). Slow 2xx responses are not listed here — check latency charts above. For API log correlation use booking/package IDs from the report and <code>SMOKE_IDS</code> lines in the log.</p>`;
  }

  const cards = failures
    .map((f, i) => {
      const status = f.status === 0 || f.status === "0" ? "0 / timeout" : f.status ?? "";
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

  return `<p class="note"><b>${failures.length}</b> failed request(s) captured from k6 run log (full request + response for API log diagnosis).</p>
${cards}`;
}

function injectIntoReport(reportPath, sectionHtml) {
  if (!fs.existsSync(reportPath)) return false;
  let html = fs.readFileSync(reportPath, "utf8");
  if (!html.includes(MARKER)) return false;

  const sectionStart = html.indexOf('id="ecom-failed-requests-section"');
  if (sectionStart === -1) return false;
  const markerAt = html.indexOf(MARKER, sectionStart);
  if (markerAt === -1) return false;
  const panelClose = html.indexOf("</div>", markerAt);
  if (panelClose === -1) return false;

  html =
    html.slice(0, markerAt) +
    MARKER +
    "\n" +
    sectionHtml +
    "\n      " +
    html.slice(panelClose);

  fs.writeFileSync(reportPath, html, "utf8");
  return true;
}

function main() {
  const failures = readFailuresList(FAILURES);
  const section = buildFailuresHtml(failures);

  const targets = [REPORT];
  if (fs.existsSync(LAST_REPORT)) {
    const name = fs.readFileSync(LAST_REPORT, "utf8").trim();
    if (name) targets.push(path.join(ECOM_DIR, name));
  }

  let updated = 0;
  for (const target of targets) {
    if (injectIntoReport(target, section)) {
      updated += 1;
      console.log(
        failures.length
          ? `Injected ${failures.length} failed request(s) into ${path.basename(target)}.`
          : `Error Capture updated in ${path.basename(target)} (no failures).`
      );
    }
  }

  if (!updated) {
    console.error("No ECOM report with Error Capture marker found.");
    return 1;
  }
  return 0;
}

process.exit(main());
