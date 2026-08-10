import { group, sleep } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import { login } from "./endpoints/auth.js";
import {
  createBooking,
  bookingSelect,
  packageSelect,
  getCustomer,
  addClient,
  bookingStatusList,
  confirmBooking,
  emailTemplate,
  generateEmail,
  sendEmail,
  invoiceCreate,
  bookingInvoices,
  getInvoiceById,
  searchContactByEmail,
  searchBookingByEmail,
  findPriorityAccessBooking,
  updateBookingPoReference,
  getBookingFullDetails,
  getBookingItems,
  getContactWithInvoiceAddress,
  updateClient,
} from "./endpoints/booking.js";
import { createPayment, paymentSelect, paymentCreditCardTypes } from "./endpoints/payment.js";
import { clientCategory, clientType, clientTitle, communicationTypes, country, createClient } from "./endpoints/customers.js";
import { loadProfile } from "./load-profile.js";
import { retry, UNAUTHORIZED_MSG, logErrorReport, logFailedRequest } from "../shared/helpers.js";
import { createHandleSummary } from "./ecom-handle-summary.js";

const mode = __ENV.TEST_MODE || "smoke";
/** Set to "1" to log in inside each VU (old behavior). Default: one login in setup(), token shared by all VUs. */
const PER_VU_LOGIN = __ENV.PER_VU_LOGIN === "1";
const environmentName = __ENV.ENV_NAME || __ENV.ENV || "ECOM";
const RUN_STARTED_AT = new Date();
const ENABLE_RETRIES = true;
const ENABLE_TOKEN_REFRESH_ON_401 = true;
const MAX_401_RETRIES = 3;
const THINK_TIME_MIN_S = Number(__ENV.THINK_TIME_MIN_S || "0.2");
const THINK_TIME_MAX_S = Number(__ENV.THINK_TIME_MAX_S || "1.0");
const P95_LIMIT_MS = Number(__ENV.P95_LIMIT_MS || "2000");
const P99_LIMIT_MS = Number(__ENV.P99_LIMIT_MS || "4000");
/** Skip Find Priority Access Booking (redundant — CreateBooking always runs next). Set to "0" to re-enable. */
const SKIP_FIND_PRIORITY_ACCESS_BOOKING = (__ENV.SKIP_FIND_PRIORITY_ACCESS_BOOKING ?? "1") === "1";
const endpointOrder = [
  "Login", "Client Category", "Client Type", "Client Title", "Communication Types", "Country", "Create Client",
  "Get Contact", "Search Contact By Email", "Find Priority Access Booking", "Package Select",
  "Create Booking (with package with Stock allocated)", "Update Booking PO Reference",
  "Search Booking By Email", "Booking Select", "Get Booking Full Details",
  "Get Contact With Invoice Address", "Update Client", "Get Booking Items", "Add Client",
  "Booking Status List", "Confirm Booking", "Invoice Create",
  "Payment Select", "Payment Credit Card Types", "Booking Invoices", "Create Payment",
  "Email Template", "Generate Email", "Send Email", "Get Invoice By ID", "LoginRefresh", "GetBookingFullDetailsForInvoiceFallback"
];
const flowStepOrder = [
  "Login", "ClientCategory", "ClientType", "ClientTitle", "CommunicationTypes", "Country", "CreateClient", "GetContact",
  "SearchContactByEmail", "FindPriorityAccessBooking", "PackageSelect", "CreateBooking", "UpdateBookingPoReference",
  "SearchBookingByEmail", "BookingSelectA", "GetBookingFullDetails1", "BookingSelectB", "GetBookingFullDetails2",
  "SearchContactByEmailEncoded", "GetContactWithInvoiceAddress1",
  "UpdateClient", "GetBookingFullDetails3", "GetBookingItems", "GetBookingFullDetails4", "UpdateBookingWithContact", "GetBookingFullDetails5",
  "GetContactWithInvoiceAddress2", "BookingStatusList", "ConfirmBooking", "InvoiceCreate",
  "GetContactWithInvoiceAddress3", "GetBookingFullDetails6", "GetBookingFullDetails7", "PaymentSelect", "PaymentCreditCardTypes",
  "GetBookingFullDetails8", "BookingInvoices", "CreatePayment", "EmailTemplate", "GenerateEmail",
  "SendEmail", "GetInvoiceById"
];

// Smoke correlation IDs to show in the generated HTML report.
// Using Gauge metrics (numeric) so we don't rely on tagged metric parsing.
const smokeClientIdGauge = new Gauge("smoke_client_id");
const smokeContactIdGauge = new Gauge("smoke_contact_id");
const smokeBookingIdGauge = new Gauge("smoke_booking_id");

function thinkTime() {
  const min = Number.isFinite(THINK_TIME_MIN_S) ? THINK_TIME_MIN_S : 0.2;
  const max = Number.isFinite(THINK_TIME_MAX_S) ? THINK_TIME_MAX_S : 1.0;
  const high = Math.max(min, max);
  const low = Math.min(min, max);
  const delay = low + Math.random() * (high - low);
  sleep(delay);
}

function getModeOptions(testMode) {
  if (testMode === "peak200") return loadProfile.peak200;
  if (testMode === "peak300" || testMode === "peak300_10m") return loadProfile.peak300;
  if (testMode === "peak400") return loadProfile.peak400;
  if (testMode === "peak") return loadProfile.peak;
  if (testMode === "peak100_sustained") return loadProfile.peak100_sustained;
  if (testMode === "peak100_10m") return loadProfile.peak100_10m;
  if (testMode === "peak100_constant_10m") return loadProfile.peak100_constant_10m;
  if (testMode === "peak500" || testMode === "peak500_10m") return loadProfile.peak500_10m;
  if (testMode === "peak500_constant_10m") return loadProfile.peak500_constant_10m;
  if (testMode === "peak50_5m") return loadProfile.peak50_5m;
  if (testMode === "peak20_10m") return loadProfile.peak20_10m;
  if (testMode === "smoke") return loadProfile.smoke;
  return loadProfile.smoke;
}

const baseOptions = getModeOptions(mode);
const hasPeakSteadyScenario = !!(baseOptions && baseOptions.scenarios && baseOptions.scenarios.peak_steady);
export const options = {
  ...baseOptions,
  thresholds: {
    ...(baseOptions.thresholds || {}),
    http_req_failed: ["rate<0.01"],
    http_req_duration: [`p(95)<${P95_LIMIT_MS}`, `p(99)<${P99_LIMIT_MS}`],
    ...(hasPeakSteadyScenario ? {
      "http_req_failed{scenario:peak_steady}": ["rate<0.01"],
      "http_req_duration{scenario:peak_steady}": [`p(95)<${P95_LIMIT_MS}`, `p(99)<${P99_LIMIT_MS}`],
    } : {}),
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};
for (const step of flowStepOrder) {
  if (SKIP_FIND_PRIORITY_ACCESS_BOOKING && step === "FindPriorityAccessBooking") continue;
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

export function setup() {
  if (PER_VU_LOGIN) return { perVuLogin: true };
  const token = ENABLE_RETRIES ? retry(() => login(), { attempts: 3, delayMs: 1000 }) : login();
  return { perVuLogin: false, token };
}

function track(_endpointName, fn) {
  exec.vu.tags.flow_step = _endpointName;
  try {
    return fn();
  } catch (e) {
    throw e;
  } finally {
    delete exec.vu.tags.flow_step;
    thinkTime();
  }
}

function logUnhandledFlowError(error, ctx = {}) {
  const failure = error?.k6Failure || {};
  const flowStep = failure.flowStep || exec?.vu?.tags?.flow_step || "UNMAPPED_STEP";
  const message = error?.message || String(error || "Unknown error");
  const stack = error?.stack ? String(error.stack) : "";
  const contextData = (ctx && typeof ctx === "object") ? ctx : {};
  const details = {
    endpoint: failure.endpoint || flowStep,
    status: failure.status || "EXCEPTION",
    errorMessage: message,
    bookingId: failure.bookingId || contextData.bookingId,
    contactId: failure.contactId || contextData.contactId,
    clientId: failure.clientId || contextData.rClientId || contextData.clientId,
    invoiceId: failure.invoiceId || contextData.invoiceId,
    emailId: failure.emailId || contextData.emailId,
    templateId: failure.templateId || contextData.templateId,
    paymentTermDetailId: failure.paymentTermDetailId || contextData.paymentTermDetailId,
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
    responseBody: failure.responseBody || stack || message,
    ...details,
  });
}

export default function (setupData) {
  let authRetries = 0;
  let done = false;
  const sharedToken = setupData && !setupData.perVuLogin && setupData.token ? setupData.token : null;
  const ctx = {
    contactId: __ENV.CONTACT_ID || null,
    contactEmail: __ENV.CONTACT_EMAIL || null,
  };

  while (!done) {
    try {
      if (sharedToken) {
        ctx.token = sharedToken;
      } else {
        group("001 Login", () => {
          ctx.token = track("Login", () => (ENABLE_RETRIES ? retry(() => login(), { attempts: 3, delayMs: 1000 }) : login()));
        });
      }

      group("002 ClientCategory", () => { ctx.clientCategoryId = track("ClientCategory", () => clientCategory(ctx.token)); });
      group("003 ClientType", () => { ctx.clientTypeId = track("ClientType", () => clientType(ctx.token)); });
      group("004 ClientTitle", () => { ctx.clientTitleId = track("ClientTitle", () => clientTitle(ctx.token)?.titleId); });
      group("005 communication-types", () => { Object.assign(ctx, track("CommunicationTypes", () => communicationTypes(ctx.token))); });
      group("006 Country", () => { ctx.countryId = track("Country", () => country(ctx.token)?.countryId); });

      group("007 Create Client", () => {
        const out = track("CreateClient", () => createClient(ctx.token, ctx.clientCategoryId, ctx.clientTypeId, ctx.clientTitleId, ctx.officeEmailId, ctx.personalEmailId, ctx.mobileId, ctx.homePhoneId, ctx.countryId));
        ctx.contactId = out?.contactId || ctx.contactId;
        ctx.rClientId = out?.clientId || ctx.rClientId;
        ctx.contactEmail = out?.contactEmail || ctx.contactEmail;
        if (__VU === 1) {
          const cId = Number(ctx.rClientId ?? 0);
          const ctId = Number(ctx.contactId ?? 0);
          if (Number.isFinite(cId)) smokeClientIdGauge.add(cId);
          if (Number.isFinite(ctId)) smokeContactIdGauge.add(ctId);
        }
        console.log(`SMOKE_IDS clientId=${ctx.rClientId ?? "(null)"} contactId=${ctx.contactId ?? "(null)"} email=${ctx.contactEmail ?? "(null)"} vu=${__VU ?? "(n/a)"} iter=${__ITER ?? "(n/a)"}`);
      });
      if (!ctx.contactId) ctx.contactId = __ENV.CONTACT_ID || "1";

      group("008 GET Contact", () => {
        const out = track("GetContact", () => getCustomer(ctx.token, ctx.contactId));
        Object.assign(ctx, out || {});
      });
      if (!ctx.contactEmail) ctx.contactEmail = __ENV.CONTACT_EMAIL || "";
      group("009 Search Contact By Email", () => { Object.assign(ctx, track("SearchContactByEmail", () => searchContactByEmail(ctx.token, ctx.contactEmail))); });
      if (!ctx.contactId) ctx.contactId = __ENV.CONTACT_ID || "1";
      if (!SKIP_FIND_PRIORITY_ACCESS_BOOKING) {
        group("010 Find Priority Access booking", () => { ctx.bookingId = track("FindPriorityAccessBooking", () => findPriorityAccessBooking(ctx.token, ctx.contactEmail)) || ctx.bookingId; });
      }

      // Order: Package Select (random from array) → Create Booking with that package
      group("011 Package Select", () => {
        const pkg = track("PackageSelect", () => packageSelect(ctx.token));
        ctx.packageId = pkg?.packageId || ctx.packageId;
        ctx.pStartDate = pkg?.pStartDate || ctx.pStartDate;
        ctx.pEndDate = pkg?.pEndDate || ctx.pEndDate;
      });

      group("012 Create Booking (with package with Stock allocated)", () => {
        const createFn = () =>
          createBooking(ctx.token, ctx.contactId, ctx.packageId, ctx.pStartDate, ctx.pEndDate);
        const out = track("CreateBooking", () =>
          ENABLE_RETRIES ? retry(createFn, { attempts: 3, delayMs: 1000 }) : createFn()
        );
        ctx.bookingId = out?.bookingId || ctx.bookingId;
        ctx.contactId = out?.contactId || ctx.contactId;
        ctx.packageId = out?.packageId || ctx.packageId;
        ctx.paymentTermDetailId = out?.paymentTermDetailId || ctx.paymentTermDetailId;
        ctx.pStartDate = out?.pStartDate || ctx.pStartDate;
        ctx.pEndDate = out?.pEndDate || ctx.pEndDate;
      });
      group("013 Update Booking PO Reference", () => { track("UpdateBookingPoReference", () => updateBookingPoReference(ctx.token, ctx.bookingId)); });
      group("014 Search Booking By Email", () => { ctx.bookingId = track("SearchBookingByEmail", () => searchBookingByEmail(ctx.token, ctx.contactEmail)) || ctx.bookingId; });
      if (!ctx.bookingId) throw new Error("booking_id correlation failed after create/search booking");
      if (__VU === 1) {
        const bId = Number(ctx.bookingId ?? 0);
        if (Number.isFinite(bId)) smokeBookingIdGauge.add(bId);
      }
      console.log(`SMOKE_IDS bookingId=${ctx.bookingId ?? "(null)"} packageId=${ctx.packageId ?? "(null)"} clientId=${ctx.rClientId ?? "(null)"} contactId=${ctx.contactId ?? "(null)"} email=${ctx.contactEmail ?? "(null)"} vu=${__VU ?? "(n/a)"} iter=${__ITER ?? "(n/a)"}`);

      group("015 Bookings-Select", () => { Object.assign(ctx, track("BookingSelectA", () => bookingSelect(ctx.token, ctx.bookingId))); });
      group("016 Get Booking Full Details", () => {
        const out = track("GetBookingFullDetails1", () => getBookingFullDetails(ctx.token, ctx.bookingId));
        Object.assign(ctx, out || {});
        ctx.paymentTermDetailId = out?.paymentTermDetailId || ctx.paymentTermDetailId;
      });
      group("017 Booking Select", () => { Object.assign(ctx, track("BookingSelectB", () => bookingSelect(ctx.token, ctx.bookingId))); });
      group("018 Get Booking Full Details", () => {
        const out = track("GetBookingFullDetails2", () => getBookingFullDetails(ctx.token, ctx.bookingId));
        Object.assign(ctx, out || {});
        ctx.paymentTermDetailId = out?.paymentTermDetailId || ctx.paymentTermDetailId;
      });

      group("019 Search Contact By Email", () => { Object.assign(ctx, track("SearchContactByEmailEncoded", () => searchContactByEmail(ctx.token, ctx.contactEmail))); });
      group("020 Get Contact With Invoice Address", () => { Object.assign(ctx, track("GetContactWithInvoiceAddress1", () => getContactWithInvoiceAddress(ctx.token, ctx.contactId))); });
      group("021 Update Client", () => { track("UpdateClient", () => updateClient(ctx.token, ctx.rClientId)); });
      group("022 Get Booking Full Details", () => {
        const out = track("GetBookingFullDetails3", () => getBookingFullDetails(ctx.token, ctx.bookingId));
        Object.assign(ctx, out || {});
        ctx.paymentTermDetailId = out?.paymentTermDetailId || ctx.paymentTermDetailId;
      });
      group("023 Get Booking Items", () => { ctx.bookingItemId = track("GetBookingItems", () => getBookingItems(ctx.token, ctx.bookingId)); });
      group("024 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails4", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("025 Update Booking with contact", () => { track("UpdateBookingWithContact", () => addClient(ctx.token, ctx.bookingId, ctx.contactId)); });
      group("026 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails5", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("027 Get Contact With Invoice Address", () => { Object.assign(ctx, track("GetContactWithInvoiceAddress2", () => getContactWithInvoiceAddress(ctx.token, ctx.contactId))); });

      // Separate status lookup from confirm PATCH so report timings stay clean.
      group("028 Booking Status List", () => {
        ctx.confirmedStatusId = track("BookingStatusList", () => bookingStatusList(ctx.token)) || "60";
      });
      group("029 Confirm booking", () => {
        track("ConfirmBooking", () => confirmBooking(ctx.token, ctx.bookingId, ctx.confirmedStatusId));
      });
      group("030 InvoiceCreate", () => { ctx.invoiceId = track("InvoiceCreate", () => invoiceCreate(ctx.token, ctx.bookingId, ctx.paymentTermDetailId)); });
      group("031 Get Contact With Invoice Address", () => { Object.assign(ctx, track("GetContactWithInvoiceAddress3", () => getContactWithInvoiceAddress(ctx.token, ctx.contactId))); });
      group("032 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails6", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("033 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails7", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("034 Booking Payment GET", () => { track("PaymentSelect", () => paymentSelect(ctx.token, ctx.bookingId)); });
      group("035 Payment-credit-card-types", () => { track("PaymentCreditCardTypes", () => paymentCreditCardTypes(ctx.token)); });
      group("036 Get Booking Full Details", () => { Object.assign(ctx, track("GetBookingFullDetails8", () => getBookingFullDetails(ctx.token, ctx.bookingId))); });
      group("037 BookingInvoices", () => {
        const inv = track("BookingInvoices", () => bookingInvoices(ctx.token, ctx.bookingId));
        ctx.invoiceId = inv?.id || ctx.invoiceId;
        ctx.totalAmount = inv?.amount || ctx.totalAmount;
      });
      if (!ctx.invoiceId && !ctx.totalAmount) {
        const full = track("GetBookingFullDetailsForInvoiceFallback", () => getBookingFullDetails(ctx.token, ctx.bookingId));
        ctx.invoiceId = full?.invoiceId || ctx.invoiceId;
      }
      group("038 Payment", () => { track("CreatePayment", () => createPayment(ctx.token, ctx.bookingId, ctx.invoiceId, ctx.totalAmount)); });
      group("039 EmailTemplate", () => { ctx.templateId = track("EmailTemplate", () => emailTemplate(ctx.token)); });
      if (__ENV.ECOM_BOOKING_CONFIRMATION_EMAIL_TEMPLATE) ctx.templateId = __ENV.ECOM_BOOKING_CONFIRMATION_EMAIL_TEMPLATE;
      group("040 BookingEmailGenerate", () => { ctx.emailId = track("GenerateEmail", () => generateEmail(ctx.token, ctx.bookingId, ctx.templateId)?.emailId); });
      group("041 BookingEmailSend", () => { track("SendEmail", () => sendEmail(ctx.token, ctx.bookingId, ctx.emailId)); });
      group("042 Get Invoice By ID", () => { track("GetInvoiceById", () => getInvoiceById(ctx.token, ctx.invoiceId)); });

      done = true;
    } catch (e) {
      if (ENABLE_TOKEN_REFRESH_ON_401 && e.message === UNAUTHORIZED_MSG && authRetries < MAX_401_RETRIES) {
        authRetries += 1;
        ctx.token = track("LoginRefresh", () => login());
      } else {
        if (!e.k6Failure) {
          logUnhandledFlowError(e, ctx);
        }
        throw e;
      }
    }
  }
}