import { group, sleep, check } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import { login, getMe } from "./endpoints/auth.js";
import {
  getAsset,
  getPrivatePackages,
  selectPackage,
  getItems,
  selectItem,
  getTimeslots,
  findFreeHalfHourSlot,
  getCalculatedPrice,
} from "./endpoints/catalog.js";
import {
  createDraftBooking,
  submitEnquiry,
  getBookingConfirmation,
  assertEnquiryZeroCost,
} from "./endpoints/booking.js";
import { emailForVu, TEST_PASSWORD, ASSET_ID, FROM_DATE, TO_DATE, SCAN_DAYS } from "./data.js";
import { loadProfile } from "./load-profile.js";
import { retry, logErrorReport, logFailedRequest } from "../shared/helpers.js";
import { createHandleSummary } from "./nsc-handle-summary.js";

const mode = __ENV.TEST_MODE || "smoke";
const environmentName = __ENV.ENV_NAME || __ENV.ENV || "NSC";
const ENABLE_RETRIES = (__ENV.ENABLE_RETRIES ?? "0") === "1"; // writes: default no retry (historical safety)
const THINK_TIME_ENABLED = (__ENV.THINK_TIME_ENABLED ?? "1") === "1";
const THINK_TIME_MIN_S = Number(__ENV.THINK_TIME_MIN_S || "0.2");
const THINK_TIME_MAX_S = Number(__ENV.THINK_TIME_MAX_S || "0.5");
const ITERATION_DELAY_S = Number(__ENV.ITERATION_DELAY_S || "0");
const ITERATIONS_PER_USER = Number(__ENV.NSC_ITERATIONS_PER_USER || "0"); // 0 = profile-driven only
const RUN_ID = __ENV.NSC_RUN_ID || `NSC-${mode}`;

const flowStepOrder = [
  "Login",
  "Identity",
  "Asset",
  "Packages",
  "Items",
  "Availability",
  "Price",
  "CreateDraft",
  "SubmitEnquiry",
  "Confirmation",
];

const smokeBookingIdGauge = new Gauge("smoke_booking_id");
const smokePackageIdGauge = new Gauge("smoke_package_id");
const smokeItemIdGauge = new Gauge("smoke_item_id");

function thinkTime() {
  if (!THINK_TIME_ENABLED) return;
  const min = Number.isFinite(THINK_TIME_MIN_S) ? THINK_TIME_MIN_S : 0.2;
  const max = Number.isFinite(THINK_TIME_MAX_S) ? THINK_TIME_MAX_S : 0.5;
  const high = Math.max(min, max);
  const low = Math.min(min, max);
  const delay = low + Math.random() * (high - low);
  if (delay > 0) sleep(delay);
}

function iterationDelay() {
  if (ITERATION_DELAY_S > 0) sleep(ITERATION_DELAY_S);
}

function getModeOptions(testMode) {
  const key = String(testMode || "smoke");
  if (loadProfile[key]) return loadProfile[key];
  return loadProfile.smoke;
}

const baseOptions = getModeOptions(mode);
export const options = {
  noCookiesReset: true,
  ...baseOptions,
  thresholds: {
    ...(baseOptions.thresholds || {}),
    http_req_failed: ["rate<0.01"],
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

function track(endpointName, fn) {
  exec.vu.tags.flow_step = endpointName;
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
    packageId: failure.packageId || ctx.packageId,
    contactId: failure.contactId || ctx.customerId,
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

export default function () {
  if (!TEST_PASSWORD) {
    exec.test.abort("NSC_TEST_PASSWORD (or PASSWORD) is required");
  }
  const email = emailForVu(__VU);
  if (!email) {
    exec.test.abort("NSC_TEST_EMAIL_1 (or NSC_TEST_EMAIL / USERNAME) is required");
  }
  if (ITERATIONS_PER_USER > 0 && exec.vu.iterationInScenario >= ITERATIONS_PER_USER) {
    sleep(1);
    return;
  }

  const ctx = { email, packageId: null, bookingId: null, customerId: null, itemId: null };

  try {
    group("001 Login", () => {
      const doLogin = () => login(email, TEST_PASSWORD);
      track("Login", () => (ENABLE_RETRIES ? retry(doLogin, { attempts: 3, delayMs: 1000 }) : doLogin()));
    });

    group("002 Identity", () => {
      const me = track("Identity", () => getMe(email));
      ctx.me = me;
      ctx.customerId = me.id;
    });

    group("003 Asset", () => {
      ctx.asset = track("Asset", () => getAsset(ASSET_ID));
    });

    group("004 Packages", () => {
      const packages = track("Packages", () => getPrivatePackages(ASSET_ID));
      ctx.pkg = selectPackage(packages);
      ctx.packageId = ctx.pkg.id;
      check(null, { "package selected": () => !!ctx.pkg?.id });
      console.log(
        JSON.stringify({
          runId: RUN_ID,
          vu: __VU,
          event: "package_selected",
          id: ctx.pkg.id,
          name: ctx.pkg.name,
        })
      );
    });

    group("005 Items", () => {
      const catIds = (ctx.pkg.salesCategories || []).map((c) => c.id);
      const items = track("Items", () => getItems(ASSET_ID, catIds));
      ctx.item = selectItem(items);
      ctx.itemId = ctx.item.id;
    });

    group("006 Availability", () => {
      const slots = track("Availability", () => getTimeslots(ASSET_ID, FROM_DATE, TO_DATE));
      ctx.slot = findFreeHalfHourSlot(slots, FROM_DATE, SCAN_DAYS);
    });

    group("007 Price", () => {
      ctx.price = track("Price", () =>
        getCalculatedPrice(ctx.item.id, ctx.slot.start, ctx.slot.end, ctx.me.concessionGroupId)
      );
    });

    const bookingName = `${RUN_ID}-VU${__VU}-I${exec.vu.iterationInScenario + 1}`;
    console.log(
      JSON.stringify({
        runId: RUN_ID,
        vu: __VU,
        event: "create_attempt",
        bookingName,
        date: ctx.slot.date,
        startTime: ctx.slot.startTime,
        endTime: ctx.slot.endTime,
        retryAllowed: ENABLE_RETRIES,
      })
    );

    group("008 Create Draft", () => {
      const createFn = () =>
        createDraftBooking({
          bookingName,
          asset: ctx.asset,
          pkg: ctx.pkg,
          item: ctx.item,
          slot: ctx.slot,
          price: ctx.price,
        });
      const created = track("CreateDraft", () =>
        ENABLE_RETRIES ? retry(createFn, { attempts: 2, delayMs: 1500 }) : createFn()
      );
      ctx.created = created;
      ctx.bookingId = created.bookingId;
      console.log(
        JSON.stringify({
          runId: RUN_ID,
          vu: __VU,
          event: "created",
          bookingId: created.bookingId,
          reference: created.bookingReference,
          bookingName,
        })
      );
    });

    group("009 Submit Enquiry", () => {
      track("SubmitEnquiry", () =>
        submitEnquiry({ bookingId: ctx.bookingId, bookingName, me: ctx.me })
      );
    });

    group("010 Confirmation", () => {
      const booking = track("Confirmation", () => getBookingConfirmation(ctx.bookingId));
      assertEnquiryZeroCost(booking, ctx.created);
      console.log(
        JSON.stringify({
          runId: RUN_ID,
          vu: __VU,
          event: "confirmed",
          bookingId: ctx.bookingId,
          reference: ctx.created.bookingReference,
          status: booking?.bookingStatus,
          totalAmount: booking?.totalAmount,
        })
      );
      console.log(
        `SMOKE_IDS bookingId=${ctx.bookingId} reference=${ctx.created.bookingReference} packageId=${ctx.packageId} itemId=${ctx.itemId} customerId=${ctx.customerId} vu=${__VU} iter=${__ITER}`
      );
      if (__VU === 1) {
        const bId = Number(ctx.bookingId ?? 0);
        const pId = Number(ctx.packageId ?? 0);
        const iId = Number(ctx.itemId ?? 0);
        if (Number.isFinite(bId)) smokeBookingIdGauge.add(bId);
        if (Number.isFinite(pId)) smokePackageIdGauge.add(pId);
        if (Number.isFinite(iId)) smokeItemIdGauge.add(iId);
      }
    });

    iterationDelay();
  } catch (e) {
    if (!e.k6Failure) logUnhandledFlowError(e, ctx);
    throw e;
  }
}
