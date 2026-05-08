/**
 * WCC-only k6 entrypoint. Artifacts: ./wcc/ (report.html, summary.json, metrics.json, k6-run.log, failed-requests.*).
 *
 * HOW THIS RUNS: All HTTP traffic is executed by **k6** (`k6/http` from this script and `wcc-expanded-flow.js`).
 * The Postman collection under `wcc/postman/` is **not** run by Postman here — it is only a **reference** for URLs,
 * bodies, and step order. `npm run smoke:wcc` / `peak50:wcc` invoke `k6 run wcc-script.js` (see `run-wcc-load-test.js`).
 *
 * Simple booking iteration: 1 login + 30 HTTP calls aligned to Postman folder "2 - Simple booking" (paths/query match;
 *   Create Empty is moved to step 7 so booking-scoped GETs use the VU’s new booking id).
 * Complex booking iteration: 1 login + 7 HTTP calls (8 when a pre-invoice booking GET is needed for line items) — Postman folder "3 - Complex booking" (recurring, add client, confirm, invoice, payment, note, task).
 * Login: Postman-equivalent POST. Load: optional `WCC_LOAD_LOGIN_USER` / `WCC_LOAD_LOGIN_PASSWORD`. Smoke (two cohorts): `WCC_SMOKE_SIMPLE_LOGIN_*` then `WCC_SMOKE_COMPLEX_LOGIN_*` — each falls back to main/load creds (see `wccLoginJsonBody`).
 *
 * Smoke (default):
 *   npm run smoke:wcc
 *   (or: cd wcc && k6 run wcc-script.js)
 *
 * Peak wave 10 minutes (10 → 50 → 10 VUs, 80% simple / 20% complex by default):
 *   npm run peak50:wcc
 *
 * Flat 50 VUs for 10 minutes:
 *   npm run peak50:const:wcc
 *
 * Flow selection (smoke only — default runs both booking types in order):
 *   -e WCC_FLOW=simple
 *   -e WCC_FLOW=complex
 *   -e WCC_FLOW=both
 *
 * Load / peak (TEST_MODE ≠ smoke): WCC_FLOW defaults to a mixed profile — ~80% of VUs run the simple
 * day-package path, ~20% the complex recurring path (VU mod 10). Force all simple or all complex with
 * WCC_FLOW=simple | complex.
 *
 * Dates (private event — no overlapping days):
 * - Simple: pool **WCC_SIMPLE_POOL_FIRST** … **WCC_SIMPLE_POOL_LAST** (default `2026-05-01` … `2035-12-30`), one day per booking.
 *   Slot = `WCC_RUN_DATE_SHIFT_DAYS` + `(VU−1)` + `WCC_ALLOC_VU_STRIDE × iteration` (stride ≥ peak VUs so slots stay unique until wrap).
 * - Complex: pool **WCC_COMPLEX_POOL_FIRST** … **WCC_COMPLEX_POOL_LAST** (default `2037-01-01` … `2045-12-30`), non-overlapping 5-day blocks; same slot formula addresses block index.
 * - Optional skips: `WCC_EXCLUDED_SIMPLE_SLOTS` (0-based day indices), `WCC_EXCLUDED_SIMPLE_DATES` (YYYY-MM-DD), `WCC_EXCLUDED_COMPLEX_BLOCKS` (0-based block indices).
 * - Strict overflow: `WCC_DATE_ALLOC_STRICT=true` fails when slot exceeds pool instead of wrapping (wrap can collide).
 * - Created booking IDs: JSON lines `WCC_BOOKING_CREATED` on stdout (see `onBookingCreated` in this file).
 *
 * If UAT returns 400 on confirm (e.g. "Maximum concurrent booking limit exceeded" for a shared asset),
 * skip confirmation but keep the rest of the simple path:
 *   -e WCC_SKIP_SIMPLE_CONFIRM=true
 */
import http from "k6/http";
import { group } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import { wccLoadProfile } from "./wcc-load-profile.js";
import { WCC_REPORT_FLOW_STEP_ORDER } from "./wcc-report-flow-order.js";
import {
  BASE_URL,
  wccConfig,
  wccLoginJsonBody,
  resolveSimpleBookingDayRange,
  resolveComplexRecurrenceRangeForVu,
} from "./wcc-data.js";
import { runWccSimpleExpandedFlow, runWccComplexExpandedFlow } from "./wcc-expanded-flow.js";
import { validate, getHeaders, REQUEST_TIMEOUT, logFailedRequest } from "../shared/helpers.js";
export { handleSummary } from "./wcc-handle-summary.js";

const mode = __ENV.TEST_MODE || "smoke";
const flow = (__ENV.WCC_FLOW || "both").toLowerCase();
const skipSimpleConfirm =
  __ENV.WCC_SKIP_SIMPLE_CONFIRM === "true" || __ENV.WCC_SKIP_SIMPLE_CONFIRM === "1";
const profile = wccLoadProfile[mode] || wccLoadProfile.smoke;
const isSmoke = mode === "smoke";
// Global offset added to every raw slot / block index (bump the whole run forward in the pool).
const runDateShiftDays = (() => {
  const raw = __ENV.WCC_RUN_DATE_SHIFT_DAYS;
  if (raw === undefined || String(raw).trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
})();

/** Must be ≥ max VUs in the test so `(VU−1) + stride×iter` stays unique per (VU, iter) before wrap. */
const allocVuStride = (() => {
  const raw = __ENV.WCC_ALLOC_VU_STRIDE;
  if (raw === undefined || String(raw).trim() === "") return 50;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 50;
})();

// Same gauge names as LA28 so the HTML report "Correlation IDs" section fills in on smoke (VU 1).
const smokeClientIdGauge = new Gauge("smoke_client_id");
const smokeContactIdGauge = new Gauge("smoke_contact_id");
const smokeBookingIdGauge = new Gauge("smoke_booking_id");
const smokeComplexBookingIdGauge = new Gauge("smoke_complex_booking_id");
const smokeComplexContactIdGauge = new Gauge("smoke_complex_contact_id");

const wccThresholds = {
  // Smoke may hit UAT "concurrent booking limit" on confirm — allow slightly higher failure rate.
  http_req_failed: [isSmoke ? "rate<0.12" : "rate<0.10"],
  http_req_duration: ["p(95)<25000"],
  // Load runs many booking iterations; a few step failures are common on shared UAT — keep thresholds realistic so the HTML report remains the source of truth (endpoint tables still show per-step failures).
  checks: [isSmoke ? "rate>0.99" : "rate>0.92"],
};
for (const step of WCC_REPORT_FLOW_STEP_ORDER) {
  const selector = `{flow_step:${step}}`;
  wccThresholds[`endpoint_requests${selector}`] = ["count>=0"];
  wccThresholds[`endpoint_duration${selector}`] = ["avg>=0"];
  wccThresholds[`endpoint_failures${selector}`] = ["count>=0"];
}

export const options = {
  ...profile,
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  thresholds: wccThresholds,
};

function recordSmokeCorrelationIds(clientId, contactId, bookingId) {
  if (!isSmoke || __VU !== 1) return;
  const c = Number(clientId ?? 0);
  const ct = Number(contactId ?? 0);
  const b = Number(bookingId ?? 0);
  if (Number.isFinite(c) && c > 0) smokeClientIdGauge.add(c);
  if (Number.isFinite(ct) && ct > 0) smokeContactIdGauge.add(ct);
  if (Number.isFinite(b) && b > 0) smokeBookingIdGauge.add(b);
  console.log(
    `SMOKE_IDS clientId=${clientId ?? "(null)"} contactId=${contactId ?? "(null)"} bookingId=${bookingId ?? "(null)"} vu=${__VU} iter=${__ITER}`
  );
}

function recordSmokeComplexCorrelationIds(contactId, bookingId) {
  if (!isSmoke || __VU !== 1) return;
  const ct = Number(contactId ?? 0);
  const b = Number(bookingId ?? 0);
  if (Number.isFinite(ct) && ct > 0) smokeComplexContactIdGauge.add(ct);
  if (Number.isFinite(b) && b > 0) smokeComplexBookingIdGauge.add(b);
  console.log(
    `SMOKE_IDS_COMPLEX contactId=${contactId ?? "(null)"} bookingId=${bookingId ?? "(null)"} vu=${__VU} iter=${__ITER}`
  );
}

/**
 * @param {"simple"|"complex"|undefined} smokeCohort Login pool for smoke (simple vs complex); ignored when not smoke.
 */
function wccLogin(smokeCohort, loginFlowStep) {
  exec.vu.tags.flow_step = loginFlowStep || "WCC_Simple_00_Login";
  if (isSmoke) {
    exec.vu.tags.wcc_login_mode =
      smokeCohort === "complex" ? "smoke_complex" : smokeCohort === "simple" ? "smoke_simple" : "smoke";
  } else {
    exec.vu.tags.wcc_login_mode = "load";
  }
  const res = http.post(`${BASE_URL}/api/v4.1/users/login?fields=token`, wccLoginJsonBody(isSmoke, smokeCohort || ""), {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: REQUEST_TIMEOUT,
  });
  validate(res, "WCC Login");
  const body = res.json();
  const token = body.token || body.data?.token || body.meta?.token;
  if (!token) throw new Error("WCC login: token not found in response");
  return token;
}

/**
 * Raw slot index from VU+iteration ladder.
 * Unique per (VU, iteration) while `allocVuStride >= max VUs`.
 */
function allocationRawIndex(vu, iter) {
  const vuSafe = Math.max(1, Number(vu) || 1);
  const iterSafe = Math.max(0, Number(iter) || 0);
  return runDateShiftDays + (vuSafe - 1) + iterSafe * allocVuStride;
}

/**
 * Cohort ordering helper: ordinal index among simple or complex VUs within one iteration.
 */
function isSimpleVuByIndex(zeroBasedVu) {
  return (zeroBasedVu % 10) < 8;
}

function countCohortPerIter(totalVus, simple) {
  const total = Math.max(1, Number(totalVus) || 1);
  let n = 0;
  for (let i = 0; i < total; i++) {
    const isSimple = isSimpleVuByIndex(i);
    if ((simple && isSimple) || (!simple && !isSimple)) n += 1;
  }
  return n;
}

function cohortOrdinalInIter(zeroBasedVu, totalVus, simple) {
  let n = 0;
  for (let i = 0; i <= zeroBasedVu; i++) {
    const isSimple = isSimpleVuByIndex(i);
    if ((simple && isSimple) || (!simple && !isSimple)) n += 1;
  }
  return Math.max(0, n - 1);
}

/**
 * Strict orderly sequence in mixed mode:
 * simple dates become day 0,1,2,3... ; complex blocks become block 0,1,2,3...
 */
function mixedModeSequentialIndex(vu, iter, simple) {
  const vuSafe = Math.max(1, Number(vu) || 1);
  const iterSafe = Math.max(0, Number(iter) || 0);
  const total = Math.max(1, allocVuStride);
  const zeroBasedVu = vuSafe - 1;
  const perIter = countCohortPerIter(total, simple);
  const localOrdinal = cohortOrdinalInIter(zeroBasedVu, total, simple);
  return runDateShiftDays + iterSafe * perIter + localOrdinal;
}

function cfgForSimplePath(vu, iter) {
  const raw = !isSmoke && flow === "both" ? mixedModeSequentialIndex(vu, iter, true) : allocationRawIndex(vu, iter);
  const day = resolveSimpleBookingDayRange(raw);
  const cfg = { ...wccConfig(), ...day, wccDateAllocRawIndex: raw };
  if (day.slotIndex != null) exec.vu.tags.wcc_simple_pool_slot = String(day.slotIndex);
  return cfg;
}

function cfgForComplexPath(vu, iter) {
  const raw = !isSmoke && flow === "both" ? mixedModeSequentialIndex(vu, iter, false) : allocationRawIndex(vu, iter);
  const cfg = { ...wccConfig(resolveComplexRecurrenceRangeForVu(raw)) };
  cfg.wccDateAllocRawIndex = raw;
  if (cfg.wccComplexBlockIndex != null) exec.vu.tags.wcc_complex_block = String(cfg.wccComplexBlockIndex);
  return cfg;
}

/**
 * Structured log line for grep / cancel scripts. Example:
 * WCC_BOOKING_CREATED {"event":"WCC_BOOKING_CREATED","path":"simple","bookingId":"<example>",...}
 */
function logBookingCreated(payload) {
  console.log(
    `WCC_BOOKING_CREATED ${JSON.stringify({
      event: "WCC_BOOKING_CREATED",
      ts: new Date().toISOString(),
      vu: __VU,
      iter: __ITER,
      ...payload,
    })}`
  );
}

function simpleFlow(token, cfg) {
  runWccSimpleExpandedFlow(token, cfg, {
    skipSimpleConfirm,
    recordSmokeCorrelationIds,
    onBookingCreated: (meta) =>
      logBookingCreated({
        path: "simple",
        bookingId: meta.bookingId,
        simpleDayStart: meta.simpleDayStart,
        simpleDayEnd: meta.simpleDayEnd,
        poolSlot: meta.poolSlot,
        poolDayCount: meta.poolDayCount,
        rawAllocIndex: meta.rawAllocIndex,
      }),
  });
}

function complexFlow(token, cfg) {
  try {
    runWccComplexExpandedFlow(token, cfg, {
      recordSmokeComplexCorrelationIds,
      onBookingCreated: (meta) =>
        logBookingCreated({
          path: "complex",
          bookingId: meta.bookingId,
          complexStart: meta.complexStart,
          complexEnd: meta.complexEnd,
          blockIndex: meta.blockIndex,
          blockCapacity: meta.blockCapacity,
          rawAllocIndex: meta.rawAllocIndex,
        }),
    });
  } catch (e) {
    // HTTP failures logged in validate() already carry `k6Failure`; avoid duplicate records.
    if (!(e && e.k6Failure)) {
      const flowStep = exec?.vu?.tags?.flow_step || "WCC_Complex_Unhandled";
      logFailedRequest({
        requestTime: new Date().toISOString(),
        url: "",
        method: "",
        status: "SCRIPT_ERROR",
        responseTimeMs: null,
        flowStep,
        endpoint: "WCC Complex Flow Error",
        responseBody: String(e?.message || e),
      });
    }
    throw e;
  }
}

/** ~80% simple / ~20% complex when WCC_FLOW is both (default) under load (VU 1-based). */
function vuRunsSimplePath() {
  return ((__VU - 1) % 10) < 8;
}

export default function main() {
  exec.vu.tags.wcc_run_key = `vu${__VU}|iter${__ITER}`;

  if (isSmoke) {
    if (flow === "simple") {
      const token = wccLogin("simple", "WCC_Simple_00_Login");
      group("wcc_simple (smoke)", () => simpleFlow(token, cfgForSimplePath(__VU, __ITER)));
      return;
    }
    if (flow === "complex") {
      const token = wccLogin("complex", "WCC_Complex_00_Login");
      group("wcc_complex (smoke)", () => complexFlow(token, cfgForComplexPath(__VU, __ITER)));
      return;
    }
    group("wcc_simple — day package (smoke 1/2)", () => {
      const token = wccLogin("simple", "WCC_Simple_00_Login");
      simpleFlow(token, cfgForSimplePath(1, 0));
    });
    group("wcc_complex — 2037+ recurring pool (smoke 2/2)", () => {
      const token = wccLogin("complex", "WCC_Complex_00_Login");
      complexFlow(token, cfgForComplexPath(1, 0));
    });
    return;
  }

  if (flow === "simple") {
    const token = wccLogin(undefined, "WCC_Simple_00_Login");
    group("wcc_simple (load — 100%)", () => simpleFlow(token, cfgForSimplePath(__VU, __ITER)));
    return;
  }
  if (flow === "complex") {
    const token = wccLogin(undefined, "WCC_Complex_00_Login");
    group("wcc_complex (load — 100%)", () => complexFlow(token, cfgForComplexPath(__VU, __ITER)));
    return;
  }

  if (vuRunsSimplePath()) {
    const token = wccLogin(undefined, "WCC_Simple_00_Login");
    group("wcc_simple (~80% cohort)", () => simpleFlow(token, cfgForSimplePath(__VU, __ITER)));
  } else {
    const token = wccLogin(undefined, "WCC_Complex_00_Login");
    group("wcc_complex (~20% cohort)", () => complexFlow(token, cfgForComplexPath(__VU, __ITER)));
  }
}
