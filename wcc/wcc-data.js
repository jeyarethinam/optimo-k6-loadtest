/**
 * WCC UAT configuration and JSON bodies for k6 (separate from LA28 `data.js`).
 * Override via env vars (same names as Postman `WCC-UAT` where applicable).
 */

import { allocateSimpleBookingDay, allocateComplexFiveDayBlock } from "./wcc-date-allocation.js";

function envNum(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name, fallback) {
  const v = __ENV[name];
  return v !== undefined && v !== "" ? v : fallback;
}

export const BASE_URL = envStr("WCC_BASE_URL", "https://wcc-uat.optimo.training/restapi");

export const LOGIN_PAYLOAD = {
  username: envStr("WCC_LOGIN_USER", ""),
  password: envStr("WCC_LOGIN_PASSWORD", ""),
};

/** Web origin for non-`/restapi` routes (e.g. Postman `GET User` under `/bookingmanager/`). */
export function wccWebOrigin() {
  return String(BASE_URL || "").replace(/\/?restapi\/?$/i, "");
}

/**
 * JSON body for `POST .../users/login?fields=token`.
 *
 * Load: `WCC_LOAD_LOGIN_USER` + `WCC_LOAD_LOGIN_PASSWORD` when set, else `WCC_LOGIN_*`.
 *
 * Smoke: use separate cohorts so simple and complex can log in as different users (mirrors Postman).
 * - Simple: `WCC_SMOKE_SIMPLE_LOGIN_USER` / `WCC_SMOKE_SIMPLE_LOGIN_PASSWORD`, else `WCC_LOGIN_*`.
 * - Complex: `WCC_SMOKE_COMPLEX_LOGIN_USER` / `WCC_SMOKE_COMPLEX_LOGIN_PASSWORD`, else load creds, else `WCC_LOGIN_*`.
 *
 * @param {"simple"|"complex"|""} [smokeCohort] Only used when `isSmoke` is true.
 */
export function wccLoginJsonBody(isSmoke, smokeCohort) {
  const loadU = __ENV.WCC_LOAD_LOGIN_USER;
  const loadP = __ENV.WCC_LOAD_LOGIN_PASSWORD;
  if (!isSmoke && loadU && loadP) {
    return JSON.stringify({ username: loadU, password: loadP });
  }
  if (!isSmoke) {
    return JSON.stringify(LOGIN_PAYLOAD);
  }
  if (smokeCohort === "complex") {
    const su = __ENV.WCC_SMOKE_COMPLEX_LOGIN_USER;
    const sp = __ENV.WCC_SMOKE_COMPLEX_LOGIN_PASSWORD;
    if (su !== undefined && String(su).trim() !== "" && sp !== undefined && String(sp).trim() !== "") {
      return JSON.stringify({ username: String(su), password: String(sp) });
    }
    if (loadU && loadP) {
      return JSON.stringify({ username: loadU, password: loadP });
    }
    return JSON.stringify(LOGIN_PAYLOAD);
  }
  if (smokeCohort === "simple") {
    const su = __ENV.WCC_SMOKE_SIMPLE_LOGIN_USER;
    const sp = __ENV.WCC_SMOKE_SIMPLE_LOGIN_PASSWORD;
    if (su !== undefined && String(su).trim() !== "" && sp !== undefined && String(sp).trim() !== "") {
      return JSON.stringify({ username: String(su), password: String(sp) });
    }
    return JSON.stringify(LOGIN_PAYLOAD);
  }
  return JSON.stringify(LOGIN_PAYLOAD);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Simple (day-package): one calendar day per booking from pool **WCC_SIMPLE_POOL_FIRST** … **WCC_SIMPLE_POOL_LAST**
 * (defaults `2026-05-01` … `2035-12-30`). `slotIndex` is the 0-based day index into that pool after `allocateSimpleBookingDay`
 * (see `wcc-date-allocation.js` + `wcc-script.js` stride).
 *
 * Legacy: if `WCC_SIMPLE_ANCHOR_DATE` is set, adds `slotIndex` as whole days to that anchor (ignores pool bounds) — prefer pool envs.
 */
export function resolveSimpleBookingDayRange(slotIndex) {
  const legacyAnchor = __ENV.WCC_SIMPLE_ANCHOR_DATE && String(__ENV.WCC_SIMPLE_ANCHOR_DATE).trim() !== "";
  if (legacyAnchor) {
    const off = Math.max(0, Number(slotIndex) || 0);
    const anchorStr = envStr("WCC_SIMPLE_ANCHOR_DATE", "2026-05-10");
    const segs = String(anchorStr).trim().split("-").map((x) => parseInt(x, 10));
    const y = Number.isFinite(segs[0]) ? segs[0] : 2026;
    const mo = Number.isFinite(segs[1]) ? segs[1] : 5;
    const day = Number.isFinite(segs[2]) ? segs[2] : 10;
    let d = new Date(y, mo - 1, day + off);
    if (Number.isNaN(d.getTime())) {
      d = new Date(2026, 4, 10 + off);
    }
    const ym = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return {
      simpleDayStart: `${ym}T00:00:00`,
      simpleDayEnd: `${ym}T23:59:59`,
    };
  }
  return allocateSimpleBookingDay(slotIndex);
}

/** Complex recurring diary: manual window only when `WCC_COMPLEX_RECURRENCE_START` / `WCC_COMPLEX_RECURRENCE_END` are set. */
export function resolveComplexRecurrenceRange() {
  return {
    complexStart: envStr("WCC_COMPLEX_RECURRENCE_START", "2037-01-01T00:00:00"),
    complexEnd: envStr("WCC_COMPLEX_RECURRENCE_END", "2037-01-05T23:59:59"),
  };
}

/**
 * Sequential non-overlapping 5-day blocks from **WCC_COMPLEX_POOL_FIRST** (default `2037-01-01`) through pool last day.
 * If either `WCC_COMPLEX_RECURRENCE_START` or `WCC_COMPLEX_RECURRENCE_END` is set, auto-blocking is skipped and
 * `resolveComplexRecurrenceRange()` fixed window is used instead.
 */
export function resolveComplexRecurrenceRangeForVu(blockIndex) {
  const hasManual =
    (__ENV.WCC_COMPLEX_RECURRENCE_START && String(__ENV.WCC_COMPLEX_RECURRENCE_START).trim() !== "") ||
    (__ENV.WCC_COMPLEX_RECURRENCE_END && String(__ENV.WCC_COMPLEX_RECURRENCE_END).trim() !== "");
  if (hasManual) {
    return resolveComplexRecurrenceRange();
  }
  return allocateComplexFiveDayBlock(blockIndex);
}

export function wccConfig(complexRangeOverride) {
  const complexRange = complexRangeOverride || resolveComplexRecurrenceRange();
  const complexMeta =
    complexRange && typeof complexRange === "object"
      ? {
          ...(complexRange.blockIndex != null ? { wccComplexBlockIndex: complexRange.blockIndex } : {}),
          ...(complexRange.blockCapacity != null ? { wccComplexBlockCapacity: complexRange.blockCapacity } : {}),
        }
      : {};
  return {
    /** Keep package/item display name fixed for WCC (do not randomize). */
    loadTestDisplayName: envStr("WCC_LOAD_TEST_DISPLAY_NAME", "Load Test 24/04/2026"),
    simplePackageId: envStr("WCC_SIMPLE_PACKAGE_ID", "251"),
    simpleEventId: envStr("WCC_SIMPLE_EVENT_ID", "44"),
    generalAdmissionItemId: envStr("WCC_GENERAL_ADMISSION_ITEM_ID", "8941"),
    simpleConfirmStatusId: envStr("WCC_SIMPLE_CONFIRM_STATUS_ID", "57"),
    simpleDayStart: envStr("WCC_SIMPLE_DAY_START", "2026-05-01T00:00:00"),
    simpleDayEnd: envStr("WCC_SIMPLE_DAY_END", "2026-05-01T23:59:59"),
    defaultVenueId: envNum("WCC_DEFAULT_VENUE_ID", 345),
    accountManagerUserId: envStr("WCC_ACCOUNT_MANAGER_USER_ID", "2"),
    clientCategoryId: envStr("WCC_CLIENT_CATEGORY_ID", "2"),
    clientTypeId: envStr("WCC_CLIENT_TYPE_ID", "1"),
    sharedContactId: envStr("WCC_SHARED_CONTACT_ID", "3864"),
    /** Legacy: complex create uses `simplePackageId` / `simpleEventId` (same day-package as simple). Kept for env parity only. */
    complexPackageId: envStr("WCC_COMPLEX_PACKAGE_ID", "76"),
    complexDraftStatusId: envStr("WCC_COMPLEX_DRAFT_STATUS_ID", "53"),
    priceConcessionId: envStr("WCC_PRICE_CONCESSION_ID", "8"),
    complexAssetId: envStr("WCC_COMPLEX_ASSET_ID", "1476"),
    complexEventConfigurationId: envStr("WCC_COMPLEX_EVENT_CONFIGURATION_ID", "1835"),
    complexStart: complexRange.complexStart,
    complexEnd: complexRange.complexEnd,
    ...complexMeta,
    postmanSeedClientId: envStr("WCC_POSTMAN_SEED_CLIENT_ID", "1"),
    postmanSeedContactId: envStr("WCC_POSTMAN_SEED_CONTACT_ID", "1"),
    currencyId: envStr("WCC_CURRENCY_ID", "7"),
    simplePaymentAmount: envNum("WCC_SIMPLE_PAYMENT_AMOUNT", 200),
    complexPaymentAmount: envNum("WCC_COMPLEX_PAYMENT_AMOUNT", 27720),
    modifyPriceUnitTax: envNum("WCC_MODIFY_PRICE_UNIT_TAX", 200),
    entityProfileId: envStr("WCC_ENTITY_PROFILE_ID", "4"),
    taskAssignGroupId: envStr("WCC_TASK_ASSIGN_GROUP_ID", "38"),
    /** Optional override when Postman-style invoice has no line-item ids (see `buildWccInvoicePaymentTermBody`). */
    paymentTermDetailId: envStr("WCC_PAYMENT_TERM_DETAIL_ID", ""),
  };
}

/** First payment-term detail id linked from a `paymentTerm` entry in booking `included` (LA28-style discovery). */
export function extractPaymentTermDetailIdFromBookingIncluded(json) {
  if (!json?.included) return "";
  for (const item of json.included) {
    if (String(item?.type || "").toLowerCase() === "paymentterm") {
      const id = item?.relationships?.paymentTermDetails?.data?.[0]?.id;
      if (id != null && String(id).trim() !== "") return String(id);
    }
  }
  return "";
}

/**
 * Invoice from payment schedule (no booking line-item ids). Same contract as LA28 `invoiceCreate` payload.
 */
export function buildWccInvoicePaymentTermBody(paymentTermDetailId) {
  const raw = String(paymentTermDetailId ?? "").trim();
  if (!raw) {
    throw new Error("WCC invoice payment-term: paymentTermDetailId required");
  }
  return {
    data: {
      type: "invoice",
      id: "-1",
      attributes: { IsSeparateInvoice: true, IncludeBond: 0 },
      relationships: {
        PaymentTermSteps: {
          data: [{ id: "-1", type: "PaymentTermDetail" }],
        },
      },
    },
    included: [
      {
        type: "PaymentTermDetail",
        id: "-1",
        attributes: { Id: raw },
      },
    ],
  };
}

export const SIMPLE_BOOKING_INCLUDE =
  "Client,Salesperson,Bookingpackages,BookingItems,Contact,CommunicationMethods,Bookingstatus,invoiceAddress,deliveryAddress,mailingAddress,cancellationPolicy,paymentTerm,deliveryMethod,bondActivity,BookingUserDefinedFields,BookingQuestionnaires,referrerClient,referrerContact,address,priceConcession,BookingDetailStatus,package,packageBusinessArea,UserDefinedFields,AttendeeCaptureProfile,emailProfile,BookingMarketingMediums,venue,asset,FulfilmentStatus";

/** New corporate client + contact per VU/iteration (simple-booking path). */
export function buildWccCorporateClient(uniqueKey, cfg) {
  const vid = cfg.defaultVenueId;
  const uid = cfg.accountManagerUserId;
  const email = `wcc_k6_${uniqueKey}@example.test`;
  const clientName = `WCC_Load_${uniqueKey}`;
  return {
    data: {
      type: "CorporateClient",
      tid: "-1",
      attributes: {
        ProfilePicture: "",
        Active: true,
        ClientName: clientName,
        ClientCategoryId: cfg.clientCategoryId,
        ClientTypeId: cfg.clientTypeId,
        DateRegistered: new Date().toISOString().slice(0, 19).replace("T", " "),
        suspendedBy: "Optimo User",
      },
      relationships: {
        accountmanager: { data: { id: uid, type: "user" } },
        defaultvenue: { data: { id: vid, type: "venue" } },
        Address: { data: { id: "-5", type: "Address" } },
        PriceConcession: { data: { id: -1, type: "PriceConcession" } },
        communicationMethods: {
          data: [
            { id: "-1", type: "CommunicationMethod" },
            { id: "-2", type: "CommunicationMethod" },
          ],
        },
        contacts: { data: [{ id: "-1", type: "Contact" }] },
        clientVenues: { data: [{ id: vid, type: "venue" }] },
        bookingTypes: { data: [] },
      },
    },
    included: [
      {
        type: "venue",
        id: String(vid),
        attributes: {
          description: "",
          userDefault: true,
          venueTypeId: 1,
          venueType: "Default Venue",
          email: "testbookings@optimosoftware.biz",
          assetClassID: 0,
          name: "Alamanda Reserve",
        },
      },
      {
        type: "CommunicationMethod",
        id: "-5",
        attributes: { communicationTypeID: "6", value: email },
      },
      {
        type: "CommunicationMethod",
        id: "-4",
        attributes: { communicationTypeID: "5", value: email },
      },
      {
        type: "CommunicationMethod",
        id: "-3",
        attributes: { communicationTypeID: "1", value: "4758590222" },
      },
      {
        type: "CommunicationMethod",
        id: "-2",
        attributes: { communicationTypeID: "5", value: email },
      },
      {
        type: "CommunicationMethod",
        id: "-1",
        attributes: { communicationTypeID: "1", value: "7594993933" },
      },
      {
        type: "Address",
        id: "-5",
        attributes: {
          Address1: "22 Sylvan Way",
          postCode: "679000",
          city: "Parsippany, NJ 07054",
          countryId: "14",
        },
      },
      {
        type: "Contact",
        id: "-1",
        attributes: {
          UserName: "",
          Active: true,
          TitleId: "2",
          FirstName: "WCC",
          LastName: `L_${String(uniqueKey).slice(-8)}`,
          DecisionMaker: false,
          isSameAsClientAddress: true,
          isPrimaryContact: false,
          isDefaultInvoiceContact: false,
        },
        relationships: {
          defaultvenue: { data: { id: vid, type: "venue" } },
          CommunicationMethods: {
            data: [
              { id: "-3", type: "CommunicationMethod" },
              { id: "-4", type: "CommunicationMethod" },
              { id: "-5", type: "CommunicationMethod" },
            ],
          },
          accountManager: { data: { id: uid, type: "user" } },
        },
      },
    ],
  };
}

export function buildSimpleAddPackageBody(bookingId, cfg, packageDisplayName) {
  return {
    data: {
      type: "booking",
      attributes: { attendees: 1 },
      relationships: {
        bookingPackages: { data: [{ id: "-1", type: "BookingPackage" }] },
      },
      id: String(bookingId),
    },
    included: [
      {
        type: "BookingPackage",
        id: "-1",
        attributes: {
          Name: packageDisplayName,
          Quantity: 1,
          Attendees: 1,
          StartDate: cfg.simpleDayStart,
          EndDate: cfg.simpleDayEnd,
          PriceTypeId: 1,
          UnitPrice: 0,
          TaxRate: 1,
          Margin: 0,
          SingleDayPackage: true,
          waitListEnabled: false,
          sequence: 0,
          netAmount: 0,
          totalAmount: 0,
          reserveInExternalSystem: false,
          unitPriceIncludingTax: 0,
          unitPriceExcludingTax: 0,
          grossAmount: 0,
        },
        relationships: {
          Package: { data: { id: cfg.simplePackageId, type: "PrivatePackage" } },
          Event: { data: { id: cfg.simpleEventId, type: "Event" } },
        },
      },
    ],
  };
}

export function buildSimpleUpsellBody(bookingId, bookingPackageId, cfg, itemLabel) {
  return {
    data: {
      type: "booking",
      id: String(bookingId),
      attributes: { queueFlow: false },
      relationships: {
        bookingPackages: { data: [{ id: String(bookingPackageId), type: "BookingPackage" }] },
      },
    },
    included: [
      {
        type: "BookingPackage",
        id: String(bookingPackageId),
        attributes: { name: itemLabel },
        relationships: {
          bookingItems: { data: [{ id: "-1", type: "PrivateBookinggeneralAdmissionItem" }] },
          package: { data: { id: cfg.simplePackageId, type: "PrivatePackage" } },
        },
      },
      {
        type: "PrivateBookinggeneralAdmissionItem",
        id: "-1",
        attributes: {
          Upsell: true,
          name: itemLabel,
          quantity: 1,
          ItineraryItem: false,
          DespatchItem: false,
          PrintBeforeDespatch: false,
          ScanBeforeDespatch: false,
          ShowInInvoice: true,
          StartTime: cfg.simpleDayStart,
          EndTime: cfg.simpleDayEnd,
          units: 24,
        },
        relationships: {
          Item: { data: { id: cfg.generalAdmissionItemId, type: "generalAdmissionItem" } },
          priceGroup: { data: { id: "1", type: "PriceGroup" } },
        },
      },
    ],
  };
}

export function buildConfirmSimpleBody(bookingId, cfg) {
  return {
    data: {
      type: "booking",
      attributes: { expiryDate: null, temporary: false, queueFlow: false },
      relationships: {
        bookingStatus: { data: { id: cfg.simpleConfirmStatusId, type: "bookingStatus" } },
      },
      id: String(bookingId),
    },
  };
}

/**
 * Complex / diary recurring booking (shared contact added in a follow-up PATCH).
 * Uses the same private package + event as simple (`simplePackageId`, `simpleEventId`), not a separate “business” package.
 *
 * @param {string} [packageDisplayName] Same style as simple `buildSimpleAddPackageBody` (e.g. `WCC_Simple_${suffix}`).
 */
export function buildComplexRecurringBooking(cfg, packageDisplayName) {
  const s = cfg.complexStart;
  const e = cfg.complexEnd;
  const ast = cfg.complexAssetId;
  const pkgLabel = packageDisplayName != null && String(packageDisplayName).trim() !== "" ? String(packageDisplayName) : "WCC_k6_recurring";
  return {
    data: {
      type: "booking",
      attributes: { salesChannelId: 1 },
      relationships: {
        bookingPackages: { data: [{ id: "-1", type: "BookingPackage" }] },
        bookingStatus: { data: { id: cfg.complexDraftStatusId, type: "bookingStatus" } },
        priceConcession: { data: { id: cfg.priceConcessionId, type: "priceConcession" } },
      },
    },
    included: [
      {
        type: "BookingPackage",
        id: "-1",
        attributes: {
          name: pkgLabel,
          priceTypeId: 1,
          quantity: 1,
          attendees: 1,
          startDate: s,
          endDate: e,
          singleDayPackage: true,
          sequence: 1,
        },
        relationships: {
          package: { data: { id: cfg.simplePackageId, type: "PrivatePackage" } },
          event: { data: { id: cfg.simpleEventId, type: "Event" } },
          bookingItems: { data: [{ id: "-1", type: "PrivateBookingGeneralAdmissionItem" }] },
        },
      },
      {
        type: "PrivateBookingGeneralAdmissionItem",
        id: "-1",
        attributes: {
          name: pkgLabel,
          startTime: s,
          endTime: e,
          itemTypeId: 1,
          recurrent: true,
          quantity: 1,
          itineraryItem: false,
          upsell: true,
        },
        relationships: {
          item: { data: { id: cfg.generalAdmissionItemId, type: "generalAdmissionItem" } },
          allocations: { data: [{ id: "-1", type: "Allocation" }] },
          recurrenceOption: { data: { id: "-1", type: "RecurrenceOption" } },
        },
      },
      {
        type: "RecurrenceOption",
        id: "-1",
        attributes: {
          startTime: s,
          endTime: e,
          excludeDates: [],
          recurrenceOptionId: 1,
          recurrenceStartDate: s,
          recurrenceEndAfter: 5,
          occurrences: 1,
          assets: String(ast),
        },
      },
      {
        type: "Allocation",
        id: "-1",
        attributes: { Preliminary: 0, Reserved: 1 },
        relationships: {
          timeslot: { data: { id: "-1", type: "PrivateEventFacilityTimeslot" } },
        },
      },
      {
        type: "PrivateEventFacilityTimeslot",
        id: "-1",
        attributes: { startTime: s, endTime: e },
        relationships: {
          asset: { data: { id: cfg.complexAssetId, type: "facility" } },
          eventConfiguration: { data: { id: cfg.complexEventConfigurationId, type: "EventConfiguration" } },
        },
      },
    ],
  };
}

export function buildPatchAddContactToBooking(bookingId, contactId) {
  return {
    data: {
      type: "booking",
      attributes: { queueFlow: false },
      relationships: {
        contact: { data: { id: String(contactId), type: "contact" } },
        InvoiceContact: { data: { id: String(contactId), type: "contact" } },
      },
      id: String(bookingId),
    },
  };
}

/**
 * Postman "Invoice Create" shape: one or more `bookingItem` server ids (from booking `included` after confirm).
 */
export function buildWccPostmanStyleInvoice(contactId, bookingItemServerIds) {
  const raw = bookingItemServerIds.map(String).filter(Boolean);
  if (!raw.length) {
    throw new Error("WCC invoice: no booking item server ids (need items on booking JSON).");
  }
  const use = raw.slice(0, 5);
  const lineData = [];
  const included = [
    {
      type: "address",
      id: "-1",
      attributes: {
        Id: "46139",
        address1: "22 Sylvan Way",
        address2: "",
        address3: "",
        city: "Parsippany, NJ 07054",
        countryID: 14,
        country: "Australia",
        county: "",
        stateCode: "",
        postCode: "679000",
      },
    },
  ];
  for (let i = 0; i < use.length; i++) {
    const tid = String(-(i + 1));
    lineData.push({ tid, type: "invoiceItem" });
    included.push({
      type: "invoiceItem",
      id: tid,
      tid,
      attributes: {},
      relationships: {
        bookingItem: { data: { tid, type: "bookingItem" } },
      },
    });
    included.push({
      type: "bookingItem",
      id: tid,
      tid,
      attributes: { id: use[i] },
    });
  }
  return {
    data: {
      type: "Invoice",
      id: "-1",
      attributes: {},
      relationships: {
        invoiceLines: { data: lineData },
        Contact: { data: { id: String(contactId), type: "contact" } },
        Address: { data: { id: "-1", type: "address" } },
      },
    },
    included,
  };
}

export function buildWccCreditCardPayment(bookingId, invoiceId, amount, currencyId, userId) {
  return {
    data: {
      type: "creditCardReceipt",
      attributes: {
        paidAmount: amount,
        allocatedAmount: amount,
        currencyRate: 1,
        paymentNote: "",
        holderName: "k6 WCC",
        creditCardTypeID: "1",
        last4Digits: "1234",
        authorisationCode: "123",
      },
      relationships: {
        booking: { data: { id: String(bookingId), type: "booking" } },
        currency: { data: { id: String(currencyId), type: "currency" } },
        user: { data: { id: String(userId), type: "user" } },
        invoice: { data: [{ id: String(invoiceId), type: "invoice" }] },
        site: { data: { type: "site" } },
      },
    },
  };
}

/** Postman "Add Booking Note" shape (short text for k6; same field contract as collection). */
export function buildWccPostmanBookingNoteBody() {
  return {
    data: {
      type: "note",
      attributes: {
        entityType: "Booking",
        entityTypeID: 10,
        noteType: "General",
        noteTypeId: 1,
        html: '<div style="font-size: 16px;"><span style="font-size: 13px;">k6 WCC load test note</span></div>',
        plainText: "k6 WCC load test note",
      },
    },
  };
}

/** Postman "Add Booking Task" → `POST .../api/V4.2/tasks`. */
export function buildWccPostmanBookingTaskBody(bookingId, cfg) {
  const bid = String(bookingId);
  const due = cfg.simpleDayEnd || cfg.complexEnd || "2026-04-30T14:47:00";
  const taskDate = cfg.simpleDayStart || cfg.complexStart || "2026-04-26T14:47:39";
  const uid = String(cfg.accountManagerUserId);
  const gid = String(cfg.taskAssignGroupId);
  return {
    data: {
      type: "bookingTask",
      id: "-1",
      attributes: {
        reference: `BP${bid}`,
        taskType: "Booking",
        taskTypeId: 1,
        isActive: true,
        dueDate: due,
        taskActiveScenarioId: "1",
        periodId: 10,
        dateTypeId: 4,
        durationTypeId: 1,
        noOfDays: 3,
        setSpecificTime: true,
        isAutoDueDate: true,
        specificTime: due,
        reminderDate: "",
        sendReminderForAssignee: false,
        name: "Task A",
        date: taskDate,
        note: "",
      },
      relationships: {
        taskNotifications: {
          data: [
            { id: "-1", type: "taskNotification" },
            { id: "-2", type: "taskNotification" },
            { id: "-3", type: "taskNotification" },
            { id: "-4", type: "taskNotification" },
          ],
        },
        taskAutoCancellation: { data: [{ id: "-1", type: "taskAutoCancel" }] },
        fromUser: { data: { id: uid, type: "user" } },
        assignedUserGroups: { data: [{ id: gid, type: "group" }] },
      },
    },
    included: [
      { type: "user", id: uid, attributes: { firstName: "Optimo", lastName: "User" } },
      { type: "taskAutoCancel", id: "-1", attributes: { scenarioId: 1 } },
      {
        type: "taskNotification",
        id: "-4",
        attributes: { scenarioId: 3, notificationType: 1, notificationTypeID: 1 },
      },
      {
        type: "taskNotification",
        id: "-3",
        attributes: { scenarioId: 3, notificationType: 2, notificationTypeID: 2, templateId: "39" },
      },
      {
        type: "taskNotification",
        id: "-2",
        attributes: { scenarioId: 2, notificationType: 1, notificationTypeID: 1 },
      },
      {
        type: "taskNotification",
        id: "-1",
        attributes: { scenarioId: 1, notificationType: 1, notificationTypeID: 1 },
      },
    ],
  };
}

export function buildSimpleModifyPriceBody(bookingId, bookingPackageId, unitPriceIncludingTax) {
  return {
    data: {
      type: "booking",
      attributes: { queueFlow: false },
      relationships: {
        bookingPackages: { data: [{ id: String(bookingPackageId), type: "BookingPackage" }] },
      },
      id: String(bookingId),
    },
    included: [
      {
        type: "BookingPackage",
        id: String(bookingPackageId),
        attributes: { unitPriceIncludingTax: Number(unitPriceIncludingTax) || 200 },
      },
    ],
  };
}
