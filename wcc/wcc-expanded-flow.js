/**
 * WCC simple + complex booking HTTP flows for **k6 only** (imported from `wcc-script.js`). Postman is not executed;
 * `postman/WCC-Booking-dynamic.postman_collection.json` is the spec this code mirrors.
 *
 * Postman folder "2 - Simple booking" lists Create Empty after several booking-scoped GETs; those GETs need
 * `wcc_simple_booking_id`. For dynamic k6, Create Empty runs right after GET Contact (step 7), then the
 * same URLs as Postman steps 7–13 follow. All other paths/query strings match the collection.
 *
 * Login mirrors Postman `isLoadRun`: use `WCC_LOAD_LOGIN_USER` / `WCC_LOAD_LOGIN_PASSWORD` on load when set
 * (see `wccLoginJsonBody` in wcc-data.js). Smoke `WCC_FLOW=both` uses one login for simple + complex.
 */
import http from "k6/http";
import exec from "k6/execution";
import { check } from "k6";
import { validate, getHeaders, logFailedRequest } from "../shared/helpers.js";
import {
  BASE_URL,
  SIMPLE_BOOKING_INCLUDE,
  wccWebOrigin,
  buildWccCorporateClient,
  buildSimpleAddPackageBody,
  buildSimpleUpsellBody,
  buildConfirmSimpleBody,
  buildComplexRecurringBooking,
  buildPatchAddContactToBooking,
  buildWccPostmanStyleInvoice,
  buildWccInvoicePaymentTermBody,
  extractPaymentTermDetailIdFromBookingIncluded,
  buildWccCreditCardPayment,
  buildWccPostmanBookingNoteBody,
  buildWccPostmanBookingTaskBody,
  buildSimpleModifyPriceBody,
} from "./wcc-data.js";

function findContactId(json) {
  if (!json || !json.included) return "";
  for (const x of json.included) {
    if (x.type === "Contact" || x.type === "contact") return String(x.id);
  }
  return "";
}

function findClientId(json) {
  if (!json) return "";
  const data = json.data;
  if (data && /client/i.test(String(data.type || "")) && data.id != null) return String(data.id);
  if (json.included) {
    for (const x of json.included) {
      if (x.type === "Client" || x.type === "client") return String(x.id);
    }
  }
  return "";
}

function findBookingPackageId(json) {
  if (!json) return "";
  if (json.included) {
    for (const x of json.included) {
      if (x.type === "BookingPackage") return String(x.id);
    }
  }
  const rel = json.data && json.data.relationships && json.data.relationships.bookingPackages;
  const d = rel && rel.data;
  if (d && d[0] && d[0].id) return String(d[0].id);
  return "";
}

function collectBookingItemServerIds(json) {
  const ids = [];
  const seen = new Set();
  const pushId = (raw) => {
    if (raw == null || raw === "") return;
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) return;
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!seen.has(s)) {
      seen.add(s);
      ids.push(s);
    }
  };

  if (json?.included) {
    for (const x of json.included) {
      const t = String(x.type || "");
      const looksLikeLine =
        /AdmissionItem|BookingItem|bookingItem|PrivateBooking.*Item|PackageItem|generalAdmission/i.test(t) ||
        (/Item/i.test(t) && /Booking|Private|Package|Admission/i.test(t));
      if (!looksLikeLine) continue;
      pushId(x.attributes?.id);
      pushId(x.id);
    }
  }
  const rel = json?.data?.relationships?.bookingItems?.data;
  if (Array.isArray(rel)) {
    for (const r of rel) {
      pushId(r?.id);
    }
  }
  return ids;
}

function isUatConcurrentBookingLimitResponse(res) {
  if (!res || res.status !== 400) return false;
  const b = String(res.body || "");
  return b.includes("concurrent booking limit") || b.includes("Maximum concurrent booking");
}

/** POST /bookings/:id/invoices may return `data` as object or array; types vary by payload (Postman vs payment-term). */
function readCreatedInvoiceId(res) {
  let body;
  try {
    body = res.json();
  } catch (e) {
    return "";
  }
  if (!body) return "";
  const d = body.data;
  if (d == null) return "";
  if (Array.isArray(d)) {
    const first = d.find((x) => x && x.id != null);
    return first?.id != null ? String(first.id) : "";
  }
  if (typeof d === "object" && d.id != null) return String(d.id);
  return "";
}

function readInvoiceAmountFromResponse(res, fallbackAmount) {
  let body;
  try {
    body = res && typeof res.json === "function" ? res.json() : null;
  } catch (e) {
    return Number(fallbackAmount) || 0;
  }
  const f = Number(fallbackAmount) || 0;
  if (!body) return f;

  const candidates = [];
  const push = (v) => {
    if (v == null) return;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) candidates.push(n);
  };
  const scanObj = (o) => {
    if (!o || typeof o !== "object") return;
    push(o.amount);
    push(o.total);
    push(o.totalAmount);
    push(o.grossAmount);
    push(o.netAmount);
    push(o.balanceDue);
    push(o.balance);
    if (o.attributes && typeof o.attributes === "object") scanObj(o.attributes);
  };

  const d = body.data;
  if (Array.isArray(d)) {
    for (const x of d) scanObj(x);
  } else {
    scanObj(d);
  }
  if (Array.isArray(body.included)) {
    for (const x of body.included) {
      const t = String(x?.type || "").toLowerCase();
      if (t.includes("invoice")) scanObj(x);
    }
  }
  return candidates.length ? candidates[0] : f;
}

function wccGet(token, path, step, name, ctx) {
  exec.vu.tags.flow_step = step;
  const res = http.get(`${BASE_URL}${path}`, getHeaders(token));
  validate(res, name, ctx || {});
  return res;
}

function wccGetBookingInclude(token, bookingId, include, step, name, ctx) {
  const enc = encodeURIComponent(include);
  return wccGet(token, `/api/V4.1/bookings/${bookingId}?include=${enc}`, step, name, ctx);
}

function fetchBookingItemIds(token, bookingId, step) {
  exec.vu.tags.flow_step = step;
  const enc = encodeURIComponent(SIMPLE_BOOKING_INCLUDE);
  const res = http.get(`${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${enc}`, getHeaders(token));
  validate(res, "WCC pre-invoice booking GET", { bookingId });
  const j = res.json();
  return { itemIds: collectBookingItemServerIds(j), json: j };
}

/**
 * @param {(clientId: string, contactId: string, bookingId: string) => void} [deps.recordSmokeCorrelationIds]
 * @param {(meta: object) => void} [deps.onBookingCreated] Fires after empty booking POST returns an id (stdout JSON for cancel pipelines).
 */
export function runWccSimpleExpandedFlow(token, cfg, deps) {
  const skipSimpleConfirm = deps.skipSimpleConfirm;
  const recordSmokeCorrelationIds = deps.recordSmokeCorrelationIds || (() => {});
  const onBookingCreated = deps.onBookingCreated;
  const h = getHeaders(token);
  const uid = `vu${__VU}_i${__ITER}_${Date.now()}`;
  const seedC = cfg.postmanSeedClientId;
  const seedCt = cfg.postmanSeedContactId;
  const origin = wccWebOrigin();

  exec.vu.tags.wcc_booking_path = "simple";

  wccGet(
    token,
    "/api/V4.1/bookings?include=client,contact,bookingStatus,collectionAddress,BusinessArea&page.size=10",
    "WCC_Simple_01_First10Bookings",
    "WCC Simple GET First 10 Bookings"
  );
  wccGet(
    token,
    "/api/V4.1/system/user-defined-fields?include=userDefinedFieldValues",
    "WCC_Simple_02_UserDefinedFields",
    "WCC Simple GET user-defined-fields"
  );
  wccGet(
    token,
    "/api/V4.1/products/business-areas?page.size=100",
    "WCC_Simple_03_BusinessAreas",
    "WCC Simple GET business-areas"
  );
  wccGet(token, "/api/V4.1/customers/client-types", "WCC_Simple_04_ClientTypes", "WCC Simple GET client-types");

  // Postman calls SPA `bookingmanager/api/user/GetUser` without API token (browser cookies). k6 only has the
  // REST token — use JSON:API user read instead (same slot in the flow / report).
  exec.vu.tags.flow_step = "WCC_Simple_05_GetUser";
  const userId = String(cfg.accountManagerUserId);
  let getUserRes = http.get(`${BASE_URL}/api/V4.1/users/${userId}`, getHeaders(token));
  if (getUserRes.status === 404) {
    getUserRes = http.get(`${BASE_URL}/api/v4.1/users/${userId}`, getHeaders(token));
  }
  validate(getUserRes, "WCC Simple GET User", { userId });

  wccGet(
    token,
    `/api/V4.1/customers/contacts/${seedCt}?include=client&fields=client.saleschannelID`,
    "WCC_Simple_06_GetContact",
    "WCC Simple GET Contact",
    { seedContactId: seedCt }
  );

  exec.vu.tags.flow_step = "WCC_Simple_07_CreateEmptyBooking";
  const emptyBody = JSON.stringify({ data: { type: "booking", attributes: { salesChannelId: 1 } } });
  let res = http.post(
    `${BASE_URL}/api/V4.1/bookings?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    emptyBody,
    h
  );
  validate(res, "WCC Simple Create Empty Booking", {}, { requestBody: emptyBody });
  let bookingId = res.json("data.id");
  if (!bookingId) throw new Error("simple: booking id missing");
  onBookingCreated?.({
    bookingId: String(bookingId),
    simpleDayStart: cfg.simpleDayStart,
    simpleDayEnd: cfg.simpleDayEnd,
    poolSlot: cfg.slotIndex,
    poolDayCount: cfg.poolDayCount,
    rawAllocIndex: cfg.wccDateAllocRawIndex,
  });

  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/payments`,
    "WCC_Simple_08_BookingPayments",
    "WCC Simple GET Booking Payment",
    { bookingId }
  );
  wccGet(
    token,
    "/api/V4.2/payments/payment-methods",
    "WCC_Simple_09_PaymentMethods",
    "WCC Simple GET Payment-Methods"
  );
  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/eligible-documents?onlybookingdocuments=true&documentTemplateType=worddatadocument&include=datadocument.documentTemplate&page.number=1&page.size=10&sort=Name`,
    "WCC_Simple_10_EligibleDocuments",
    "WCC Simple GET booking eligible-documents",
    { bookingId }
  );

  exec.vu.tags.flow_step = "WCC_Simple_11_BookingDetails";
  const detRes = http.get(`${origin}/bookingmanager/#/booking-details`, getHeaders(token));
  check(detRes, { "WCC Simple booking-details (SPA hash URL)": (r) => r.status === 200 || r.status === 204 });

  wccGet(
    token,
    `/api/V4.1/customers/clients/${seedC}?include=Contacts,CommunicationMethods,ContactAddresses`,
    "WCC_Simple_12_GetClient",
    "WCC Simple GET Client",
    { seedClientId: seedC }
  );
  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/documents?include=datadocument.documentTemplate,EmailDataDocument.Attachments,InvoiceDocument`,
    "WCC_Simple_13_BookingDocuments",
    "WCC Simple GET Booking Documents",
    { bookingId }
  );
  wccGet(
    token,
    `/api/V4.1/system/entity-configurations/profiles/${cfg.entityProfileId}/profile-details`,
    "WCC_Simple_14_EntityProfileDetails",
    "WCC Simple Entity-configurations profile-details"
  );
  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/cancellation-policy-schedule?include=cancellationPolicyDetail`,
    "WCC_Simple_15_CancellationPolicySchedule",
    "WCC Simple GET Cancellation-policy-schedule",
    { bookingId }
  );
  wccGet(
    token,
    "/api/V4.1/bookings/booking-statuses?filters.ShowParentBookingStatuses=true&include=BusinessAreas&sort=2",
    "WCC_Simple_16_BookingStatuses",
    "WCC Simple GET Booking Booking-statuses"
  );
  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/notes`,
    "WCC_Simple_17_BookingNotes",
    "WCC Simple GET Booking Notes",
    { bookingId }
  );
  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/invoices?include=client,InvoiceLines,RefundRequest`,
    "WCC_Simple_18_BookingInvoices",
    "WCC Simple GET Booking Invoices",
    { bookingId }
  );
  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/payment-schedule?include=PaymentTerm,PaymentTermDetails`,
    "WCC_Simple_19_PaymentSchedule",
    "WCC Simple GET Booking Payment-Schedule",
    { bookingId }
  );

  exec.vu.tags.flow_step = "WCC_Simple_20_ClientCreate";
  const clientPayload = buildWccCorporateClient(uid, cfg);
  const clientRaw = JSON.stringify(clientPayload);
  res = http.post(
    `${BASE_URL}/api/V4.1/customers/clients?include=contacts,communicationmethods,address,ContactAddresses`,
    clientRaw,
    h
  );
  validate(res, "WCC Simple Client Create", { bookingId }, { requestBody: clientPayload });
  const clientJson = res.json();
  const clientId = findClientId(clientJson);
  const contactId = findContactId(clientJson);
  if (!contactId) throw new Error("simple: contact id missing");

  exec.vu.tags.flow_step = "WCC_Simple_21_AddClientToBooking";
  const patchContact = JSON.stringify(buildPatchAddContactToBooking(bookingId, contactId));
  res = http.patch(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    patchContact,
    h
  );
  validate(res, "WCC Simple Add Client to Booking", { bookingId, contactId }, { requestBody: patchContact });

  const pkgName = String(cfg.loadTestDisplayName || "Load Test 24/04/2026");
  exec.vu.tags.flow_step = "WCC_Simple_22_AddPackage";
  const addPkg = JSON.stringify(buildSimpleAddPackageBody(bookingId, cfg, pkgName));
  res = http.patch(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    addPkg,
    h
  );
  validate(res, "WCC Simple Add Package to booking", { bookingId }, { requestBody: addPkg });
  let bookingPackageId = findBookingPackageId(res.json());
  if (!bookingPackageId) throw new Error("simple: booking package id missing");

  exec.vu.tags.flow_step = "WCC_Simple_23_AddUpsell";
  const upsell = JSON.stringify(buildSimpleUpsellBody(bookingId, bookingPackageId, cfg, pkgName));
  res = http.patch(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    upsell,
    h
  );
  validate(res, "WCC Simple Add Upsell to booking Package", { bookingId, packageId: bookingPackageId }, { requestBody: upsell });

  if (!skipSimpleConfirm) {
    exec.vu.tags.flow_step = "WCC_Simple_24_ConfirmBooking";
    const confirm = JSON.stringify(buildConfirmSimpleBody(bookingId, cfg));
    res = http.patch(
      `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
      confirm,
      h
    );
    if (isUatConcurrentBookingLimitResponse(res)) {
      // Must use validate (not a bare check) so endpoint_* counters and K6_FAILED_REQUEST / response body match http_req_failed.
      validate(res, "WCC Simple Confirm Booking", { bookingId }, { requestBody: confirm, continueOnFailure: true });
      console.warn("WCC Simple Confirm: UAT concurrent booking limit; continuing.");
    } else {
      validate(res, "WCC Simple Confirm Booking", { bookingId }, { requestBody: confirm });
    }
  } else {
    wccGetBookingInclude(
      token,
      bookingId,
      "Client,Bookingstatus,Bookingpackages",
      "WCC_Simple_24_ConfirmSkipped",
      "WCC Simple Confirm Skipped — GET booking",
      { bookingId }
    );
  }

  exec.vu.tags.flow_step = "WCC_Simple_25_ModifyBookingItemPrice";
  const modBody = JSON.stringify(buildSimpleModifyPriceBody(bookingId, bookingPackageId, cfg.modifyPriceUnitTax));
  res = http.patch(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    modBody,
    h
  );
  validate(res, "WCC Simple Modify the booking item price", { bookingId, bookingPackageId }, { requestBody: modBody });

  const afterModifyJson = res.json();
  let itemIds = collectBookingItemServerIds(afterModifyJson);
  let paymentTermDetailId =
    cfg.paymentTermDetailId || extractPaymentTermDetailIdFromBookingIncluded(afterModifyJson);
  if (!itemIds.length) {
    const fetched = fetchBookingItemIds(token, bookingId, "WCC_Simple_26a_PreInvoiceBookingGET");
    itemIds = fetched.itemIds;
    if (!paymentTermDetailId) {
      paymentTermDetailId =
        cfg.paymentTermDetailId || extractPaymentTermDetailIdFromBookingIncluded(fetched.json);
    }
  }

  exec.vu.tags.flow_step = "WCC_Simple_26_InvoiceCreate";
  let invPayload;
  if (itemIds.length) {
    invPayload = buildWccPostmanStyleInvoice(contactId, itemIds);
  } else if (paymentTermDetailId) {
    invPayload = buildWccInvoicePaymentTermBody(paymentTermDetailId);
  } else {
    throw new Error(
      "WCC invoice: no booking item server ids and no payment term detail (set WCC_PAYMENT_TERM_DETAIL_ID or ensure booking include lists items / payment term)."
    );
  }
  const invRaw = JSON.stringify(invPayload);
  res = http.post(`${BASE_URL}/api/V4.1/bookings/${bookingId}/invoices`, invRaw, h);
  validate(res, "WCC Simple Invoice Create", { bookingId }, { requestBody: invPayload });
  const invoiceId = readCreatedInvoiceId(res);
  if (!invoiceId) throw new Error("simple: invoice id missing");
  const invoiceAmount = readInvoiceAmountFromResponse(res, cfg.simplePaymentAmount);

  exec.vu.tags.flow_step = "WCC_Simple_27_CreatePayment";
  const payPayload = buildWccCreditCardPayment(
    bookingId,
    invoiceId,
    invoiceAmount,
    cfg.currencyId,
    cfg.accountManagerUserId
  );
  const payRaw = JSON.stringify(payPayload);
  res = http.post(`${BASE_URL}/api/V4.1/payments`, payRaw, h);
  validate(res, "WCC Simple Create Payment", { bookingId, invoiceId }, { requestBody: payPayload });

  exec.vu.tags.flow_step = "WCC_Simple_28_AddBookingNote";
  const notePayload = buildWccPostmanBookingNoteBody();
  const noteRaw = JSON.stringify(notePayload);
  res = http.post(`${BASE_URL}/api/V4.1/bookings/${bookingId}/notes`, noteRaw, h);
  validate(res, "WCC Simple Add Booking Note", { bookingId }, { requestBody: notePayload });

  wccGet(
    token,
    `/api/V4.1/bookings/${bookingId}/booking-packages/${bookingPackageId}/booking-items?include=allocations,timeslot,asset,item,splitBookingItems,supplier,SetupTimeslot,TeardownTimeslot,RecurrentBookingItems,RecurrenceOption,Conflicts,PrivateEventInstance,Seat,EventBlock,BookingItemDetails&attendees=1`,
    "WCC_Simple_29_BookingItemGET",
    "WCC Simple Booking Item GET",
    { bookingId, bookingPackageId }
  );

  exec.vu.tags.flow_step = "WCC_Simple_30_AddBookingTask";
  const taskPayload = buildWccPostmanBookingTaskBody(bookingId, cfg);
  const taskRaw = JSON.stringify(taskPayload);
  res = http.post(`${BASE_URL}/api/V4.2/tasks`, taskRaw, h);
  validate(res, "WCC Simple Add Booking Task", { bookingId }, { requestBody: taskPayload });

  recordSmokeCorrelationIds(clientId, contactId, bookingId);
}

/**
 * @param {(contactId: string, bookingId: string) => void} [deps.recordSmokeComplexCorrelationIds]
 * @param {(meta: object) => void} [deps.onBookingCreated] After recurring booking POST returns an id.
 */
export function runWccComplexExpandedFlow(token, cfg, deps) {
  function throwLoggedComplexError(flowStep, endpoint, message, context = {}) {
    exec.vu.tags.flow_step = flowStep;
    logFailedRequest({
      requestTime: new Date().toISOString(),
      url: "",
      method: "",
      status: "SCRIPT_ERROR",
      responseTimeMs: null,
      flowStep,
      endpoint,
      networkError: "",
      networkErrorCode: "",
      requestBody: "",
      responseBody: message,
      ...context,
    });
    throw new Error(message);
  }

  const recordSmokeComplexCorrelationIds = deps.recordSmokeComplexCorrelationIds || (() => {});
  const onBookingCreated = deps.onBookingCreated;
  const h = getHeaders(token);
  const shared = cfg.sharedContactId;

  exec.vu.tags.wcc_booking_path = "complex";

  const complexPkgName = String(cfg.loadTestDisplayName || "Load Test 24/04/2026");

  exec.vu.tags.flow_step = "WCC_Complex_01_CreateDailyRecurring";
  const createBody = JSON.stringify(buildComplexRecurringBooking(cfg, complexPkgName));
  let res = http.post(`${BASE_URL}/api/v4.1/bookings`, createBody, h);
  validate(res, "WCC Complex Create Daily Recurring -5 Days", {}, { requestBody: createBody });
  const bookingId = res.json("data.id");
  if (!bookingId) {
    throwLoggedComplexError(
      "WCC_Complex_01_CreateDailyRecurring",
      "WCC Complex Create Daily Recurring -5 Days",
      "complex: booking id missing"
    );
  }
  onBookingCreated?.({
    bookingId: String(bookingId),
    complexStart: cfg.complexStart,
    complexEnd: cfg.complexEnd,
    blockIndex: cfg.wccComplexBlockIndex,
    blockCapacity: cfg.wccComplexBlockCapacity,
    rawAllocIndex: cfg.wccDateAllocRawIndex,
  });

  exec.vu.tags.flow_step = "WCC_Complex_02_AddClient";
  const patch = JSON.stringify(buildPatchAddContactToBooking(bookingId, shared));
  res = http.patch(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    patch,
    h
  );
  validate(res, "WCC Complex Add Client", { bookingId, contactId: shared }, { requestBody: patch });

  const afterClientJson = res.json();

  exec.vu.tags.flow_step = "WCC_Complex_02b_ConfirmBooking";
  const confirmBody = JSON.stringify(buildConfirmSimpleBody(bookingId, cfg));
  res = http.patch(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(SIMPLE_BOOKING_INCLUDE)}`,
    confirmBody,
    h
  );
  if (isUatConcurrentBookingLimitResponse(res)) {
    validate(res, "WCC Complex Confirm Booking", { bookingId }, { requestBody: confirmBody, continueOnFailure: true });
    console.warn("WCC Complex Confirm: UAT concurrent booking limit; continuing.");
  } else {
    validate(res, "WCC Complex Confirm Booking", { bookingId }, { requestBody: confirmBody });
  }

  const afterConfirmJson = res.json();
  let itemIds = collectBookingItemServerIds(afterConfirmJson);
  if (!itemIds.length) itemIds = collectBookingItemServerIds(afterClientJson);
  let paymentTermDetailId =
    cfg.paymentTermDetailId ||
    extractPaymentTermDetailIdFromBookingIncluded(afterConfirmJson) ||
    extractPaymentTermDetailIdFromBookingIncluded(afterClientJson);
  if (!itemIds.length) {
    const fetched = fetchBookingItemIds(token, bookingId, "WCC_Complex_03a_PreInvoiceBookingGET");
    itemIds = fetched.itemIds;
    if (!paymentTermDetailId) {
      paymentTermDetailId =
        cfg.paymentTermDetailId || extractPaymentTermDetailIdFromBookingIncluded(fetched.json);
    }
  }

  exec.vu.tags.flow_step = "WCC_Complex_03_InvoiceCreate";
  let invPayload;
  if (itemIds.length) {
    invPayload = buildWccPostmanStyleInvoice(shared, itemIds);
  } else if (paymentTermDetailId) {
    invPayload = buildWccInvoicePaymentTermBody(paymentTermDetailId);
  } else {
    throwLoggedComplexError(
      "WCC_Complex_03_InvoiceCreate",
      "WCC Complex Invoice Create",
      "WCC invoice: no booking item server ids and no payment term detail (set WCC_PAYMENT_TERM_DETAIL_ID or ensure booking include lists items / payment term).",
      { bookingId }
    );
  }
  const invRaw = JSON.stringify(invPayload);
  res = http.post(`${BASE_URL}/api/V4.1/bookings/${bookingId}/invoices`, invRaw, h);
  validate(res, "WCC Complex Invoice Create", { bookingId }, { requestBody: invPayload });
  const invoiceId = readCreatedInvoiceId(res);
  if (!invoiceId) {
    throwLoggedComplexError(
      "WCC_Complex_03_InvoiceCreate",
      "WCC Complex Invoice Create",
      "complex: invoice id missing",
      { bookingId }
    );
  }
  const invoiceAmount = readInvoiceAmountFromResponse(res, cfg.complexPaymentAmount);

  exec.vu.tags.flow_step = "WCC_Complex_04_Payment";
  const payPayload = buildWccCreditCardPayment(
    bookingId,
    invoiceId,
    invoiceAmount,
    cfg.currencyId,
    cfg.accountManagerUserId
  );
  const payRaw = JSON.stringify(payPayload);
  res = http.post(`${BASE_URL}/api/V4.1/payments`, payRaw, h);
  validate(res, "WCC Complex Payment", { bookingId, invoiceId }, { requestBody: payPayload });

  exec.vu.tags.flow_step = "WCC_Complex_05_AddBookingNote";
  const notePayload = buildWccPostmanBookingNoteBody();
  const noteRaw = JSON.stringify(notePayload);
  res = http.post(`${BASE_URL}/api/V4.1/bookings/${bookingId}/notes`, noteRaw, h);
  validate(res, "WCC Complex Add Booking Note", { bookingId }, { requestBody: notePayload });

  exec.vu.tags.flow_step = "WCC_Complex_06_AddBookingTask";
  const taskPayload = buildWccPostmanBookingTaskBody(bookingId, cfg);
  const taskRaw = JSON.stringify(taskPayload);
  res = http.post(`${BASE_URL}/api/V4.2/tasks`, taskRaw, h);
  validate(res, "WCC Complex Add Booking Task", { bookingId }, { requestBody: taskPayload });

  recordSmokeComplexCorrelationIds(String(shared), bookingId);
}
