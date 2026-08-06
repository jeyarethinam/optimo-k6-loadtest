import { group, sleep } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import { login } from "./endpoints/auth.js";
import {
  listBookings,
  createBooking,
  getBooking,
  getNotes,
  getAuditHistories,
  addFiftyPackages,
  submitBooking,
  unsubmitBooking,
  cancelBooking,
} from "./endpoints/booking.js";
import { HRP_CONTACT_ID, uniqueEventName } from "./data.js";
import { loadProfile } from "./load-profile.js";
import { retry, UNAUTHORIZED_MSG, logErrorReport, logFailedRequest } from "../shared/helpers.js";
import { createHandleSummary } from "./hrp-handle-summary.js";

const mode = __ENV.TEST_MODE || "smoke";
const environmentName = __ENV.ENV_NAME || __ENV.ENV || "HRP";
const ENABLE_RETRIES = true;
const ENABLE_TOKEN_REFRESH_ON_401 = true;
const MAX_401_RETRIES = 3;
const THINK_TIME_MIN_S = Number(__ENV.THINK_TIME_MIN_S || "0.2");
const THINK_TIME_MAX_S = Number(__ENV.THINK_TIME_MAX_S || "1.0");
const P95_LIMIT_MS = Number(__ENV.P95_LIMIT_MS || "5000");
const P99_LIMIT_MS = Number(__ENV.P99_LIMIT_MS || "15000");
const SKIP_CANCEL = String(__ENV.HRP_SKIP_CANCEL || "").toLowerCase() === "true" || __ENV.HRP_SKIP_CANCEL === "1";
const SKIP_UNSUBMIT = String(__ENV.HRP_SKIP_UNSUBMIT || "").toLowerCase() === "true" || __ENV.HRP_SKIP_UNSUBMIT === "1";
const SKIP_AUDIT =
  __ENV.HRP_SKIP_AUDIT === undefined || __ENV.HRP_SKIP_AUDIT === ""
    ? true
    : String(__ENV.HRP_SKIP_AUDIT).toLowerCase() === "true" || __ENV.HRP_SKIP_AUDIT === "1";

const flowStepOrder = [
  "Login",
  "ListBookings",
  "CreateBooking",
  "GetBooking",
  "GetNotes",
  "GetAuditHistories",
  "Add50Packages",
  "GetBookingAfterPackages",
  "SubmitBooking",
  "UnsubmitBooking",
  "CancelBooking",
  "LoginRefresh",
];

const smokeBookingIdGauge = new Gauge("smoke_booking_id");
const smokeContactIdGauge = new Gauge("smoke_contact_id");
const smokePackageCountGauge = new Gauge("smoke_package_count");

function thinkTime() {
  const min = Number.isFinite(THINK_TIME_MIN_S) ? THINK_TIME_MIN_S : 0.2;
  const max = Number.isFinite(THINK_TIME_MAX_S) ? THINK_TIME_MAX_S : 1.0;
  const high = Math.max(min, max);
  const low = Math.min(min, max);
  sleep(low + Math.random() * (high - low));
}

function getModeOptions(testMode) {
  if (testMode === "peak120_10m") return loadProfile.peak120_10m;
  if (testMode === "peak120") return loadProfile.peak120;
  if (testMode === "peak120_constant_10m") return loadProfile.peak120_constant_10m;
  if (testMode === "peak20_10m") return loadProfile.peak20_10m;
  return loadProfile.smoke;
}

const baseOptions = getModeOptions(mode);
export const options = {
  ...baseOptions,
  thresholds: {
    ...(baseOptions.thresholds || {}),
    http_req_failed: ["rate<0.01"],
    http_req_duration: [`p(95)<${P95_LIMIT_MS}`, `p(99)<${P99_LIMIT_MS}`],
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

export const handleSummary = createHandleSummary({
  mode,
  environmentName,
  flowStepOrder,
});

function track(_endpointName, fn) {
  exec.vu.tags.flow_step = _endpointName;
  try {
    return fn();
  } finally {
    delete exec.vu.tags.flow_step;
    thinkTime();
  }
}

function logUnhandledFlowError(error, ctx = {}) {
  const failure = error?.k6Failure || {};
  const flowStep = failure.flowStep || exec?.vu?.tags?.flow_step || "UNMAPPED_STEP";
  const message = error?.message || String(error || "Unknown error");
  const details = {
    endpoint: failure.endpoint || flowStep,
    status: failure.status || "EXCEPTION",
    errorMessage: message,
    bookingId: failure.bookingId || ctx.bookingId,
    contactId: failure.contactId || ctx.contactId,
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
    responseBody: failure.responseBody || (error?.stack ? String(error.stack) : message),
    ...details,
  });
}

function slotIndexForVu() {
  const vu = Number(__VU) || 1;
  const iter = Number(__ITER) || 0;
  return (vu - 1) * 17 + iter;
}

export default function () {
  let authRetries = 0;
  let done = false;
  const ctx = {
    contactId: __ENV.HRP_CONTACT_ID || HRP_CONTACT_ID,
  };

  while (!done) {
    try {
      group("001 Login", () => {
        ctx.token = track("Login", () =>
          ENABLE_RETRIES ? retry(() => login(), { attempts: 3, delayMs: 1000 }) : login()
        );
      });

      group("002 List Bookings", () => {
        track("ListBookings", () => listBookings(ctx.token));
      });

      group("003 Create Booking", () => {
        ctx.eventName = uniqueEventName(__VU || 0, __ITER || 0);
        const out = track("CreateBooking", () =>
          ENABLE_RETRIES
            ? retry(() => createBooking(ctx.token, ctx.contactId, ctx.eventName), { attempts: 3, delayMs: 1000 })
            : createBooking(ctx.token, ctx.contactId, ctx.eventName)
        );
        ctx.bookingId = out?.bookingId || ctx.bookingId;
        ctx.contactId = out?.contactId || ctx.contactId;
        ctx.eventName = out?.eventName || ctx.eventName;
      });
      if (!ctx.bookingId) throw new Error("booking_id correlation failed after create");

      if (__VU === 1) {
        const bId = Number(ctx.bookingId ?? 0);
        const cId = Number(ctx.contactId ?? 0);
        if (Number.isFinite(bId)) smokeBookingIdGauge.add(bId);
        if (Number.isFinite(cId)) smokeContactIdGauge.add(cId);
      }
      console.log(
        `HRP_IDS bookingId=${ctx.bookingId ?? "(null)"} contactId=${ctx.contactId ?? "(null)"} event=${ctx.eventName ?? "(null)"} vu=${__VU ?? "(n/a)"} iter=${__ITER ?? "(n/a)"}`
      );

      group("004 Get Booking", () => {
        Object.assign(ctx, track("GetBooking", () => getBooking(ctx.token, ctx.bookingId)) || {});
      });
      group("005 Get Notes", () => {
        track("GetNotes", () => getNotes(ctx.token, ctx.bookingId));
      });
      if (!SKIP_AUDIT) {
        group("006 Get Audit Histories", () => {
          track("GetAuditHistories", () => getAuditHistories(ctx.token, ctx.bookingId));
        });
      }

      group("007 PATCH Add 50 Packages", () => {
        const out = track("Add50Packages", () =>
          ENABLE_RETRIES
            ? retry(
                () =>
                  addFiftyPackages(
                    ctx.token,
                    ctx.bookingId,
                    ctx.contactId,
                    slotIndexForVu(),
                    ctx.eventName
                  ),
                { attempts: 2, delayMs: 1500 }
              )
            : addFiftyPackages(ctx.token, ctx.bookingId, ctx.contactId, slotIndexForVu(), ctx.eventName)
        );
        ctx.packageCount = out?.packageCount || 0;
        if (__VU === 1 && Number.isFinite(Number(ctx.packageCount))) {
          smokePackageCountGauge.add(Number(ctx.packageCount));
        }
        console.log(
          `HRP_PACKAGES bookingId=${ctx.bookingId} packageCount=${ctx.packageCount} vu=${__VU} iter=${__ITER}`
        );
      });

      group("008 Get Booking After Packages", () => {
        Object.assign(ctx, track("GetBookingAfterPackages", () => getBooking(ctx.token, ctx.bookingId)) || {});
      });

      group("009 Submit Booking", () => {
        track("SubmitBooking", () => submitBooking(ctx.token, ctx.bookingId));
      });

      if (!SKIP_UNSUBMIT) {
        group("010 Unsubmit Booking", () => {
          track("UnsubmitBooking", () => unsubmitBooking(ctx.token, ctx.bookingId));
        });
      }

      if (!SKIP_CANCEL) {
        group("011 Cancel Booking", () => {
          track("CancelBooking", () => cancelBooking(ctx.token, ctx.bookingId));
        });
      }

      done = true;
    } catch (e) {
      if (ENABLE_TOKEN_REFRESH_ON_401 && e.message === UNAUTHORIZED_MSG && authRetries < MAX_401_RETRIES) {
        authRetries += 1;
        ctx.token = track("LoginRefresh", () => login());
      } else {
        if (!e.k6Failure) logUnhandledFlowError(e, ctx);
        throw e;
      }
    }
  }
}
