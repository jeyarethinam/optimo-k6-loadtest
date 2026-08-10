import http from "k6/http";
import { BASE_URL } from "../data.js";
import { getHeaders, validate } from "../../shared/helpers.js";

const CREATE_BOOKING_LABEL = "Create Booking (with package with Stock allocated)";

/** Default package pool — Package Select picks one at random before Create Booking. */
const DEFAULT_PACKAGE_IDS = [
  "7663", "7662", "7661", "7660", "7659", "7658", "7657", "7656", "7655", "7654",
  "7653", "7652", "7651", "7650", "7649", "7648", "7647", "7646", "7645", "7644",
  "7643", "7642", "7641", "7640", "7639", "7638", "7637", "7636", "7635", "7634",
  "7633", "7632", "7631", "7630", "7629", "7628", "7627", "7626", "7625", "7624",
  "7623", "7622", "7621", "7620", "7619", "7618", "7617", "7616", "7615", "7614",
];

function getPackageIdPool() {
  const envIds = String(__ENV.PACKAGE_IDS || __ENV.ECOM_PACKAGE_ID || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return envIds.length ? envIds : DEFAULT_PACKAGE_IDS.slice();
}

function pickRandomPackageId(exclude = []) {
  const skip = new Set((exclude || []).map((x) => String(x)));
  const pool = getPackageIdPool().filter((id) => !skip.has(String(id)));
  const ids = pool.length ? pool : getPackageIdPool();
  return String(ids[Math.floor(Math.random() * ids.length)]);
}

function extractPaymentTermDetailId(json) {
  for (const item of json?.included || []) {
    if (String(item?.type || "").toLowerCase() === "paymentterm") {
      const id = item?.relationships?.paymentTermDetails?.data?.[0]?.id || null;
      if (id) return id;
    }
  }
  return null;
}

/** Session dates only (no Package Select metric) — used on create retries. */
function fetchPackageSessionDates(token, packageId) {
  const res = http.get(
    `${BASE_URL}/api/V4.1/products/packages/${packageId}?include=PublicPackage.PackageSessions`,
    getHeaders(token)
  );
  if (res.status < 200 || res.status >= 300) {
    return {
      packageId: String(packageId),
      pStartDate: __ENV.ECOM_PACKAGE_START || "2028-07-04T08:00:00",
      pEndDate: __ENV.ECOM_PACKAGE_END || "2028-07-04T17:00:00",
    };
  }
  const body = res.json() || {};
  const included = Array.isArray(body?.included) ? body.included : [];
  const sess = included.find((x) => String(x?.type || "").toLowerCase() === "packagesession");
  return {
    packageId: body?.data?.id || String(packageId),
    pStartDate: sess?.attributes?.startTime || __ENV.ECOM_PACKAGE_START || "2028-07-04T08:00:00",
    pEndDate: sess?.attributes?.endTime || __ENV.ECOM_PACKAGE_END || "2028-07-04T17:00:00",
  };
}

function resolvePackageCandidates(preferredId) {
  const pool = getPackageIdPool();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  const ordered = [preferredId, ...pool]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  return ordered.filter((v, i, a) => a.indexOf(v) === i);
}

function isRetryablePackageCreateError(res) {
  if (res.status !== 400) return false;
  const body = String(res.body || "");
  return (
    body.includes("Sales channel does not match with the package sales channel") ||
    body.includes("The package must be active") ||
    body.includes("Valid Package Session Not Found")
  );
}

/**
 * Confirmed ecom create: package (+ stock allocation) in one POST.
 * Dates preferably from Package Select; env/curl defaults as fallback.
 */
export function createBooking(token, contactId, packageId, pStartDate, pEndDate) {
  const salesChannelId = Number(__ENV.ECOM_SALES_CHANNEL_ID || "1");
  const priceConcessionId = String(__ENV.ECOM_PRICE_CONCESSION_ID || "8");
  const candidates = resolvePackageCandidates(packageId);
  let lastRes = null;
  let lastPayload = null;
  let selectedPackageId = candidates[0] || "7663";
  let startDate = pStartDate || __ENV.ECOM_PACKAGE_START || "2028-07-04T08:00:00";
  let endDate = pEndDate || __ENV.ECOM_PACKAGE_END || "2028-07-04T17:00:00";

  for (let i = 0; i < candidates.length; i++) {
    selectedPackageId = candidates[i];
    // First attempt: dates from Package Select (already run before create).
    // Retries: pick next array id + refresh session dates quietly.
    if (i > 0 || !pStartDate || !pEndDate) {
      const sess = fetchPackageSessionDates(token, selectedPackageId);
      selectedPackageId = sess.packageId || selectedPackageId;
      startDate = sess.pStartDate || startDate;
      endDate = sess.pEndDate || endDate;
    }

    const relationships = {
      priceConcession: { data: { id: priceConcessionId, type: "priceConcession" } },
      bookingPackages: { data: [{ id: "-1", type: "bookingPackage" }] },
    };
    if (contactId) {
      relationships.contact = { data: { id: String(contactId), type: "contact" } };
    }

    const payload = {
      data: {
        type: "Booking",
        attributes: {
          salesChannelId,
          alternativeBookingRef: "",
          externalBookingId: "",
        },
        relationships,
      },
      included: [
        {
          type: "bookingPackage",
          id: "-1",
          attributes: {
            quantity: 1,
            startDate,
            endDate,
          },
          relationships: {
            package: { data: { id: selectedPackageId, type: "PublicPackage" } },
          },
        },
      ],
    };
    lastPayload = payload;

    const res = http.post(`${BASE_URL}/api/v4.1/bookings`, JSON.stringify(payload), getHeaders(token));
    lastRes = res;

    if (isRetryablePackageCreateError(res) && i < candidates.length - 1) {
      continue;
    }

    validate(res, CREATE_BOOKING_LABEL, { contactId, packageId: selectedPackageId }, { requestBody: payload });
    const body = res.json() || {};
    return {
      bookingId: body?.data?.id || null,
      contactId: body?.data?.relationships?.contact?.data?.id || contactId || null,
      packageId: selectedPackageId,
      paymentTermDetailId: extractPaymentTermDetailId(body),
      pStartDate: startDate,
      pEndDate: endDate,
    };
  }

  if (lastRes) {
    validate(lastRes, CREATE_BOOKING_LABEL, { contactId, packageId: selectedPackageId }, {
      requestBody: lastPayload,
    });
  }
  return {
    bookingId: null,
    contactId: contactId || null,
    packageId: selectedPackageId,
    paymentTermDetailId: null,
    pStartDate: startDate,
    pEndDate: endDate,
  };
}

export function bookingSelect(token, bookingId) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings/${bookingId}?include=bookingPackages,package`, getHeaders(token));
  validate(res, "Booking Select", { bookingId });
  const json = res.json() || {};
  return {
    contactId: json?.data?.relationships?.contact?.data?.id || null,
    bookingItemId: json?.data?.relationships?.bookingItems?.data?.[0]?.id || null,
  };
}

/**
 * Runs BEFORE Create Booking. Randomly picks a package id from the array
 * (or PACKAGE_IDS env), then loads session start/end for the create POST.
 */
export function packageSelect(token, packageId = null) {
  const selectedId =
    packageId != null && packageId !== ""
      ? String(packageId)
      : pickRandomPackageId();
  const res = http.get(
    `${BASE_URL}/api/V4.1/products/packages/${selectedId}?include=PublicPackage.PackageSessions`,
    getHeaders(token)
  );
  validate(res, "Package Select", { packageId: selectedId });
  const body = res.json() || {};
  const included = Array.isArray(body?.included) ? body.included : [];
  const sess = included.find((x) => String(x?.type || "").toLowerCase() === "packagesession");
  return {
    packageId: body?.data?.id || String(selectedId),
    pStartDate: sess?.attributes?.startTime || __ENV.ECOM_PACKAGE_START || "2028-07-04T08:00:00",
    pEndDate: sess?.attributes?.endTime || __ENV.ECOM_PACKAGE_END || "2028-07-04T17:00:00",
  };
}

export function addPackage(token, bookingId, packageId, pStartDate, pEndDate) {
  const envIds = (__ENV.PACKAGE_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const candidates = [String(packageId), ...envIds].filter((v, i, a) => v && a.indexOf(v) === i);
  let lastRes = null;
  let selectedPackageId = String(packageId);

  for (const candidate of candidates) {
    selectedPackageId = candidate;
    const payload = {
      data: {
        relationships: { bookingPackages: { data: [{ id: "-1", type: "BookingPackage" }] } },
        id: bookingId,
        type: "booking",
      },
      included: [
        {
          relationships: { Package: { data: { id: selectedPackageId, type: "PublicPackage" } } },
          attributes: { StartDate: pStartDate, Quantity: 1, EndDate: pEndDate },
          id: "-1",
          type: "BookingPackage",
        },
      ],
    };

    const res = http.patch(
      `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=bookingPackages,paymentTerm,invoices,contact`,
      JSON.stringify(payload),
      getHeaders(token)
    );
    lastRes = res;

    // Retry candidate package IDs for known business-rule mismatch.
    if (res.status === 400 && String(res.body || "").includes("Sales channel does not match with the package sales channel")) {
      continue;
    }

    validate(res, "Add Package", { bookingId, packageId: selectedPackageId }, { requestBody: payload });

    const json = res.json() || {};
    let paymentTermDetailId = null;
    for (const item of json?.included || []) {
      if (String(item?.type).toLowerCase() === "paymentterm") {
        paymentTermDetailId = item?.relationships?.paymentTermDetails?.data?.[0]?.id || null;
        if (paymentTermDetailId) break;
      }
    }
    return { paymentTermDetailId, packageId: selectedPackageId };
  }

  if (lastRes) {
    validate(lastRes, "Add Package", { bookingId, packageId: selectedPackageId });
  }
  return { paymentTermDetailId: null, packageId: selectedPackageId };
}

export function getCustomer(token, contactId) {
  const res = http.get(`${BASE_URL}/api/V4.1/customers/contacts/${contactId}?=&include=communicationMethods`, getHeaders(token));
  validate(res, "Get Contact");
  const body = res.json() || {};
  const data = body?.data || {};
  let communicationMethods = Array.isArray(data?.communicationMethods) ? data.communicationMethods : [];
  if (communicationMethods.length === 0 && Array.isArray(body?.included)) {
    communicationMethods = body.included
      .filter((x) => String(x?.type || "").toLowerCase() === "communicationmethod")
      .map((x) => ({
        id: x?.id,
        typeName: x?.attributes?.communicationType,
        name: x?.attributes?.communicationType,
        value: x?.attributes?.value,
      }));
  }
  const personal = communicationMethods.find((cm) => cm?.typeName === "Personal Email" || cm?.name === "Personal Email");
  const office = communicationMethods.find((cm) => cm?.typeName === "Office Email" || cm?.name === "Office Email");
  const best = personal || office;
  const contactEmail = best?.value || data?.attributes?.invoiceEmailAddress || data?.attributes?.email || null;
  return {
    contactId: data?.id || null,
    clientId: data?.relationships?.client?.data?.id || null,
    contactEmail,
    officeEmailId: office?.id || null,
    personalEmailId: personal?.id || null,
  };
}

export function addClient(token, bookingId, contactId) {
  const payload = { data: { relationships: { contact: { data: { id: contactId, type: "contact" } } }, id: bookingId, type: "booking" } };
  const res = http.patch(`${BASE_URL}/api/V4.1/bookings/${bookingId}`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Update Booking with contact", { bookingId, contactId }, { requestBody: payload });
  return true;
}

export function bookingStatusList(token) {

    const res = http.get(
        `${BASE_URL}/api/V4.1/bookings/booking-statuses?filters.bookingStatusName=confirmed&page.number=1&page.size=10`,
        getHeaders(token)
    );

    validate(res, "Booking Status List");

    if (res.status !== 200) {
        console.error("❌ BOOKING STATUS LIST FAILURE");
        console.error("Status:", res.status);
        console.error("Response:", res.body);
        return "60";
    }

    let body;
    try {
        body = res.json();
    } catch (e) {
        console.error("Booking status response not JSON");
        console.error(res.body);
        return "60";
    }

    if (!body?.data || body.data.length === 0) {
        console.warn("No booking status found. Using default status 60");
        return "60";
    }

    return body.data[0].id;
}

/**
 * PATCH only — pass confirmedStatusId from Booking Status List step.
 * Default "60" if caller did not look it up.
 */
export function confirmBooking(token, bookingId, confirmedStatusId = "60") {
  const statusId = String(confirmedStatusId || "60");
  const payload = {
    data: {
      id: bookingId,
      type: "booking",
      attributes: { temporary: false },
      relationships: {
        bookingStatus: { data: { id: statusId, type: "bookingStatus" } },
      },
    },
  };
  const res = http.patch(`${BASE_URL}/api/V4.1/bookings/${bookingId}`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Confirm Booking", { bookingId, bookingStatusId: statusId }, { requestBody: payload });
  return true;
}

export function emailTemplate(token) {

    const res = http.get(
        `${BASE_URL}/api/V4.1/documents/document-templates?filters.searchText=Email&filters.documentTypeID=7&page.number=1&page.size=1000`,
        getHeaders(token)
    );

    validate(res, "Email Template");

    if (res.status !== 200) {
        console.error("❌ EMAIL TEMPLATE LIST FAILURE");
        console.error("Status:", res.status);
        console.error("Response:", res.body);
        return null;
    }

    let body;
    try {
        body = res.json();
    } catch (e) {
        console.error("Email Template response not JSON");
        console.error(res.body);
        return null;
    }

    const templates = body?.data;

    if (!templates || !Array.isArray(templates)) {
        console.error("Template list not found in response");
        return null;
    }

    const doc = templates.find(
        t => t?.attributes?.name === "Contract Email Template - B2B"
    );

    if (!doc) {
        console.error("Required template not found: Contract Email Template - B2B");
        return null;
    }

    return doc.id;
}

export function generateEmail(token, bookingId, templateId) {

    const payload = { DocumentTemplateId: templateId };

    const res = http.post(
        `${BASE_URL}/api/V4.1/bookings/${bookingId}/emails/generate`,
        JSON.stringify(payload),
        getHeaders(token)
    );

    validate(res, "Generate Email", { bookingId, templateId }, { requestBody: payload });

    if (![200, 201].includes(res.status)) {
        console.error("❌ Generate Email FAILED");
        console.error("Booking ID:", bookingId, "Template ID:", templateId);
        console.error("Status:", res.status);
        console.error("Response:", res.body);
        return null;
    }

    let body;
    try {
        body = res.json();
    } catch (e) {
        console.error("Generate Email response not JSON");
        console.error(res.body);
        return null;
    }

    if (!body?.data) {
        return null;
    }

    return {
        emailId: body.data.id || "",
        subject: body.data.attributes?.subject || "",
        body: body.data.attributes?.body || "",
        recipient: body.data.attributes?.recipient || "",
        sendAs: body.data.attributes?.sendAs || "",
        replyTo: body.data.attributes?.replyTo || "",
        templateId: body.data.relationships?.documentTemplate?.data?.id || templateId
    };
}

export function sendEmail(
    token,
    bookingId,
    emailId
) {
    const payload = {};

    const res = http.post(
        `${BASE_URL}/api/V4.1/bookings/${bookingId}/emails/${emailId}/send`,
        JSON.stringify(payload),
        getHeaders(token)
    );

    validate(res, "Send Email", { bookingId, emailId }, { requestBody: payload });

    if (![200, 201, 204].includes(res.status)) {
        console.error("❌ BOOKING EMAIL SEND FAILURE");
        console.error("BookingID:", bookingId, "EmailID:", emailId);
        console.error("Status:", res.status);
        console.error("Response:", res.body);
        return null;
    }

    return true;
}

export function invoiceCreate(token, bookingId, paymentTermDetailId) {

    const payload = {
        data: {
            type: "invoice",
            id: "-1",
            attributes: { IsSeparateInvoice: true, IncludeBond: 0 },
            relationships: {
                PaymentTermSteps: {
                    data: [
                        {
                            id: "-1",
                            type: "PaymentTermDetail"
                        }
                    ]
                }
            }
        },
        included: [
            {
                type: "PaymentTermDetail",
                id: "-1",
                attributes: {
                    Id: paymentTermDetailId
                }
            }
        ]
    };

    const res = http.post(
        `${BASE_URL}/api/V4.1/bookings/${bookingId}/invoices`,
        JSON.stringify(payload),
        getHeaders(token)
    );

    // Postman test script allows 400/500 edge cases here when invoice already exists.
    if (res.status === 400 && String(res.body || "").includes("All the invoices have been created")) {
        return null;
    }

    validate(res, "Invoice Create", { bookingId, paymentTermDetailId }, { requestBody: payload });

    const body = res.json() || {};
    return body?.data?.id || null;
}

export function bookingInvoices(token, bookingId) {

    const res = http.get(
        `${BASE_URL}/api/V4.1/bookings/${bookingId}/invoices`,
        getHeaders(token)
    );

    validate(res, "Booking Invoices", { bookingId });

    let body;
    try {
        body = res.json();
    } catch (e) {
        return {
            id: null,
            amount: 0
        };
    }

    if (!body?.data?.length) {
        return {
            id: null,
            amount: 0
        };
    }

    const standardInvoice = body.data.find((item) => item?.type === "standardInvoice");

    const firstInvoice = body.data[0];

    return {
        id: standardInvoice?.id || firstInvoice?.id || null,
        amount: firstInvoice?.attributes?.totalAmount || 0
    };
}

export function getInvoiceById(token, invoiceId) {

    const res = http.get(
        `${BASE_URL}/api/V4.1/invoices/${invoiceId}`,
        getHeaders(token)
    );

    validate(res, "Get Invoice By ID", { invoiceId });

    let body;
    try {
        body = res.json();
    } catch (e) {
        return null;
    }

    return body?.data || null;
}

export function searchContactByEmail(token, email) {
  const res = http.get(`${BASE_URL}/api/V4.1/customers/contacts?filters.emailAddress=${encodeURIComponent(email)}`, getHeaders(token));
  validate(res, "Search Contact By Email", { email });
  const body = res.json() || {};
  const row = Array.isArray(body?.data) ? body.data[0] : body?.data;
  return {
    contactId: row?.id || null,
    contactEmail: row?.attributes?.emailAddress || email,
    clientId: row?.relationships?.client?.data?.id || null,
  };
}

export function searchBookingByEmail(token, email) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings?include=bookingPackages,paymentTerm,invoices,contact&filters.contactEmailAddress=${encodeURIComponent(email)}&filters.bookingStatusId=81&page.size=1&page.number=1&sort=-1`, getHeaders(token));
  validate(res, "Search Booking By Email", { email });
  const body = res.json() || {};
  const row = Array.isArray(body?.data) ? body.data[0] : body?.data;
  return row?.id || null;
}

export function findPriorityAccessBooking(token, email) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings?include=bookingPackages,paymentTerm,invoices,contact&filters.contactEmailAddress=${encodeURIComponent(email)}&filters.bookingStatusId=81&page.size=1&page.number=1&sort=-1`, getHeaders(token));
  validate(res, "Find Priority Access Booking", { email });
  const body = res.json() || {};
  const row = Array.isArray(body?.data) ? body.data[0] : body?.data;
  return row?.id || null;
}

export function updateBookingPoReference(token, bookingId) {
  const poReference = __ENV.PO_REFERENCE || `LT-Optimo-${bookingId}-${__VU}-${__ITER}`;
  const payload = {
    data: {
      type: "booking",
      attributes: { poReference },
      relationships: {},
      id: bookingId,
    },
  };
  const res = http.patch(`${BASE_URL}/api/V4.1/bookings/${bookingId}`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Update Booking PO Reference", { bookingId }, { requestBody: payload });
  return true;
}

export function getBookingFullDetails(token, bookingId) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings/${bookingId}?include=bookingPackages,paymentTerm,invoices,contact`, getHeaders(token));
  validate(res, "Get Booking Full Details", { bookingId });
  const json = res.json() || {};
  return {
    contactId: json?.data?.relationships?.contact?.data?.id || null,
    paymentTermDetailId: extractPaymentTermDetailId(json),
    invoiceId: json?.data?.relationships?.invoices?.data?.[0]?.id || null,
    rClientId: json?.data?.relationships?.client?.data?.id || null,
  };
}

export function getBookingItems(token, bookingId) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings/${bookingId}?include=bookingItems`, getHeaders(token));
  validate(res, "Get Booking Items", { bookingId });
  const json = res.json() || {};
  return json?.data?.relationships?.bookingItems?.data?.[0]?.id || null;
}

export function getContactWithInvoiceAddress(token, contactId) {
  const res = http.get(`${BASE_URL}/api/V4.1/customers/contacts/${contactId}?include=invoiceAddress`, getHeaders(token));
  validate(res, "Get Contact With Invoice Address", { contactId });
  const body = res.json() || {};
  return {
    contactId: body?.data?.id || contactId,
    clientId: body?.data?.relationships?.client?.data?.id || null,
  };
}

export function updateClient(token, clientId) {
  const payload = {
    data: {
      relationships: {
        accountManager: { data: { id: "2", type: "user" } },
        address: { data: { id: "4561", type: "address" } },
      },
      attributes: { ClientTypeId: "1", ClientCategoryId: "5" },
      id: clientId,
      type: "corporateClient",
    },
  };
  const res = http.patch(`${BASE_URL}/api/V4.1/customers/client/${clientId}`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Update Client", { clientId }, { requestBody: payload });
  return true;
}