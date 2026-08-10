/**
 * Extract failed request details from a k6 run log and write an error report file.
 *
 * Parses:
 *   - ERROR_REPORT endpoint=X bookingId=Y packageId=Z invoiceId=W status=S ...
 *   - Legacy: ERROR_BOOKING_ID=<id>
 *
 * Usage:
 *   node extract-error-bookings.js [logfile]
 *   node extract-error-bookings.js peak.log
 *
 * Default log file: ECOM/k6-run.log
 *
 * Output files (next to the log file, e.g. ECOM/ or wcc/):
 *   error-report.json  - full list of failures with all IDs
 *   error-report.txt   - human-readable summary
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_LOG = path.join(__dirname, "ECOM", "k6-run.log");
const logFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_LOG;
const outDir = path.dirname(logFile);
const REPORT_JSON = path.join(outDir, "error-report.json");
const REPORT_TXT = path.join(outDir, "error-report.txt");

function parseErrorReportLine(line) {
  const match = line.match(/ERROR_REPORT\s+(.+)/);
  if (!match) return null;
  const pairs = match[1].trim().split(/\s+/);
  const obj = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const key = p.slice(0, eq);
    const value = p.slice(eq + 1);
    if (key && value !== undefined) obj[key] = value;
  }
  return Object.keys(obj).length ? obj : null;
}

function main() {
  if (!fs.existsSync(logFile)) {
    console.error("Log file not found:", logFile);
    console.error("Run your test and save output first, e.g.:");
    console.error("  cd ECOM && k6 run --out json=metrics.json script.js -e TEST_MODE=peak 2>&1 | tee k6-run.log");
    console.error("  npm run peak");
    process.exit(1);
  }

  const text = fs.readFileSync(logFile, "utf8");
  const lines = text.split(/\r?\n/);

  const reports = [];
  const legacyBookingIds = new Set();

  lines.forEach((line) => {
    const parsed = parseErrorReportLine(line);
    if (parsed) {
      reports.push(parsed);
      if (parsed.bookingId) legacyBookingIds.add(parsed.bookingId);
    } else {
      const m = line.match(/ERROR_BOOKING_ID=(\d+)/);
      if (m) {
        legacyBookingIds.add(m[1]);
        reports.push({ endpoint: "(unknown)", bookingId: m[1], status: "" });
      }
    }
  });

  // Dedupe by endpoint + bookingId + invoiceId + status (keep first occurrence)
  const seen = new Set();
  const unique = reports.filter((r) => {
    const key = [r.endpoint, r.bookingId, r.invoiceId, r.packageId, r.status].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = {
    totalFailures: unique.length,
    byEndpoint: {},
    bookingIds: [...new Set(unique.map((r) => r.bookingId).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
    packageIds: [...new Set(unique.map((r) => r.packageId).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
    invoiceIds: [...new Set(unique.map((r) => r.invoiceId).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
  };

  unique.forEach((r) => {
    const e = r.endpoint || "(unknown)";
    summary.byEndpoint[e] = (summary.byEndpoint[e] || 0) + 1;
  });

  const output = {
    generatedAt: new Date().toISOString(),
    logFile: path.basename(logFile),
    summary,
    failures: unique,
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(output, null, 2), "utf8");

  const txtLines = [
    "Load test error report",
    "=====================",
    "Generated: " + output.generatedAt,
    "Log: " + output.logFile,
    "Total failures: " + summary.totalFailures,
    "",
    "By endpoint:",
    ...Object.entries(summary.byEndpoint).map(([e, c]) => "  " + e + ": " + c),
    "",
    "Booking IDs with failures: " + (summary.bookingIds.length ? summary.bookingIds.join(", ") : "(none)"),
    "Package IDs with failures: " + (summary.packageIds.length ? summary.packageIds.join(", ") : "(none)"),
    "Invoice IDs with failures: " + (summary.invoiceIds.length ? summary.invoiceIds.join(", ") : "(none)"),
    "",
    "Failure details (endpoint, bookingId, packageId, invoiceId, other IDs, status):",
    "---",
  ];

  unique.forEach((r) => {
    const parts = [
      r.endpoint,
      r.bookingId ? "bookingId=" + r.bookingId : "",
      r.packageId ? "packageId=" + r.packageId : "",
      r.invoiceId ? "invoiceId=" + r.invoiceId : "",
      r.contactId ? "contactId=" + r.contactId : "",
      r.templateId ? "templateId=" + r.templateId : "",
      r.emailId ? "emailId=" + r.emailId : "",
      r.paymentTermDetailId ? "paymentTermDetailId=" + r.paymentTermDetailId : "",
      r.status ? "status=" + r.status : "",
    ].filter(Boolean);
    txtLines.push(parts.join(" "));
  });

  fs.writeFileSync(REPORT_TXT, txtLines.join("\n"), "utf8");

  console.log("Error report written:");
  console.log("  " + REPORT_JSON);
  console.log("  " + REPORT_TXT);
  console.log("Total failures: " + summary.totalFailures);
  if (summary.bookingIds.length) console.log("Booking IDs: " + summary.bookingIds.join(", "));
  if (summary.packageIds.length) console.log("Package IDs: " + summary.packageIds.join(", "));
  if (summary.invoiceIds.length) console.log("Invoice IDs: " + summary.invoiceIds.join(", "));
}

main();
