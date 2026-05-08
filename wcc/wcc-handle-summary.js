import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { buildCustomReport } from "../shared/k6-load-report.js";
import { WCC_REPORT_FLOW_STEP_ORDER, getWccStepMeta } from "./wcc-report-flow-order.js";
import { BASE_URL } from "./wcc-data.js";

/** One-line summary for the report hero (no env jargon). */
function buildWccHeroSubtitle(isSmoke, flow, mode) {
  const peakHint =
    mode === "peak50_wave_10m"
      ? " Peak shape: 10 → 50 → 10 VUs over 10 minutes."
      : mode === "load_sanity"
        ? " Short ramp sanity run (see wcc-load-profile)."
        : "";
  if (isSmoke) {
    if (flow === "both") return "Smoke validation — simple day-package, then complex recurring booking." + peakHint;
    if (flow === "simple") return "Smoke validation — simple day-package path only." + peakHint;
    return "Smoke validation — complex recurring path only." + peakHint;
  }
  if (flow === "simple") return `Load test — all users on the simple path · ${mode}.${peakHint}`;
  if (flow === "complex") return `Load test — all users on the complex path · ${mode}.${peakHint}`;
  return `Load test — about 80% simple / 20% complex users (same rule for the whole run) · ${mode}.${peakHint}`;
}

/** Collapsible appendix only; keep README-level detail out of the main header. */
const WCC_TECHNICAL_APPENDIX =
  "Execution: k6 (wcc-script.js / wcc-expanded-flow.js), aligned to wcc/postman/WCC-Booking-dynamic.postman_collection.json (not Postman runner). Dates: simple anchor WCC_SIMPLE_ANCHOR_DATE (default 2026-05-10) + forward-only run/VU/iter day offset (WCC_RUN_DATE_SHIFT_DAYS optional); complex default sequential 5-day blocks from 2029-01-01 (1-5, 6-10, 11-15...) or WCC_COMPLEX_RECURRENCE_*. Login: WCC_LOAD_LOGIN_* / WCC_LOGIN_*; smoke cohorts WCC_SMOKE_* (wccLoginJsonBody). Peak: npm run peak50:wcc. Failures: K6_FAILED_REQUEST → npm run extract-failures:wcc.";

export function handleSummary(data) {
  const mode = __ENV.TEST_MODE || "smoke";
  const environmentName = __ENV.ENV_NAME || __ENV.ENV || "N/A";
  const flow = (__ENV.WCC_FLOW || "both").toLowerCase();
  const isSmoke = mode === "smoke";

  return {
    "report.html": buildCustomReport(data, {
      flowStepOrder: WCC_REPORT_FLOW_STEP_ORDER,
      getStepMeta: getWccStepMeta,
      mode,
      environmentName,
      wccReport: {
        isSmoke,
        flow,
        baseUrl: BASE_URL,
        heroSubtitle: buildWccHeroSubtitle(isSmoke, flow, mode),
        technicalAppendix: WCC_TECHNICAL_APPENDIX,
      },
    }),
    "summary.json": JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
