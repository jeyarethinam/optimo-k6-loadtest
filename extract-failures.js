/**
 * Extract failed API request details from a k6 run log and write JSON + CSV files.
 *
 * Parses lines: K6_FAILED_REQUEST {"requestTime":"...","url":"...", ...}
 *
 * Usage:
 *   node extract-failures.js [logfile]
 *   node extract-failures.js k6-run.log
 *
 * Default log file: ECOM/k6-run.log
 *
 * Output files (next to the log file, e.g. ECOM/, HRP/, or wcc/):
 *   failed-requests.json  - { generatedAt, totalFailedRequests, failures: [...] }
 *   failed-requests.csv    - same data in CSV format
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_LOG = path.join(__dirname, "ECOM", "k6-run.log");
const logFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_LOG;
const outDir = path.dirname(logFile);
const OUT_JSON = path.join(outDir, "failed-requests.json");
const OUT_CSV = path.join(outDir, "failed-requests.csv");

function escapeCsv(s) {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function main() {
  if (!fs.existsSync(logFile)) {
    console.error("Log file not found:", logFile);
    console.error("Run the load test with output saved, e.g.:");
    console.error("  cd ECOM && k6 run --out json=metrics.json script.js -e TEST_MODE=peak 2>&1 | tee k6-run.log");
    console.error("  npm run peak");
    process.exit(1);
  }

  const text = fs.readFileSync(logFile, "utf8");
  const lines = text.split(/\r?\n/);
  const failures = [];

  lines.forEach((line) => {
    const marker = "K6_FAILED_REQUEST ";
    const idx = line.indexOf(marker);
    if (idx === -1) return;

    let payload = "";

    // k6/logrus: msg="K6_FAILED_REQUEST <payload>" source=console
    // Prefer slice from field msg=" to closing " before source=console (avoids false trims inside JSON).
    const msgAttr = 'msg="';
    const msgIdx = line.indexOf(msgAttr);
    const lineEnd = line.lastIndexOf('" source=console');
    if (msgIdx !== -1 && lineEnd > msgIdx + msgAttr.length) {
      const inner = line.slice(msgIdx + msgAttr.length, lineEnd);
      const p = inner.indexOf(marker);
      if (p !== -1) {
        payload = inner.slice(p + marker.length).trim();
      }
    }
    if (!payload) {
      payload = line.slice(idx + marker.length).trim();
      const endQuote = payload.lastIndexOf('" source=');
      if (endQuote !== -1) payload = payload.slice(0, endQuote);
      else if (payload.endsWith('"')) payload = payload.slice(0, -1);
    }

    /** New format: base64(JSON) — no nested-quote issues in log lines. */
    let obj = null;
    try {
      const decoded = Buffer.from(payload, "base64").toString("utf8");
      obj = JSON.parse(decoded);
    } catch (_) {
      let jsonStr = payload;
      if (jsonStr.startsWith('"')) jsonStr = jsonStr.slice(1);
      jsonStr = jsonStr.replace(/\\"/g, '"');
      try {
        obj = JSON.parse(jsonStr);
      } catch (_) {}
    }

    if (obj && (obj.url != null || obj.endpoint != null || obj.status != null)) {
      failures.push(obj);
    }
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    logFile: path.basename(logFile),
    totalFailedRequests: failures.length,
    failures,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2), "utf8");

  const cols = [
    "requestTime",
    "url",
    "method",
    "status",
    "responseTimeMs",
    "flowStep",
    "bookingId",
    "packageId",
    "invoiceId",
    "contactId",
    "endpoint",
    "networkError",
    "networkErrorCode",
    "requestBody",
    "responseBody",
  ];
  const csvLines = [cols.join(",")];
  failures.forEach((r) => {
    csvLines.push(cols.map((c) => escapeCsv(r[c])).join(","));
  });
  fs.writeFileSync(OUT_CSV, csvLines.join("\n"), "utf8");

  console.log("Error report generated (reset for this run):");
  console.log("  " + OUT_JSON);
  console.log("  " + OUT_CSV);
  if (failures.length === 0) {
    console.log("  No failed requests.");
  } else {
    console.log("  Total failed requests: " + failures.length);
  }
}

main();
