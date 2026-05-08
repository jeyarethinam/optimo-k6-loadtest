import http from "k6/http";
import { BASE_URL } from "../data.js";
import { getHeaders, validate } from "../../shared/helpers.js";

export function createBooking(token, contactId) {
  const paymentTermId = __ENV.ECOM_PAYMENT_TERM_ID || "19";
  const salesChannelId = Number(__ENV.ECOM_SALES_CHANNEL_ID || "1");
  const payload = {
    data: {
      relationships: {
        contact: { data: { id: String(contactId), type: "contact" } },
        bookingStatus: { data: { id: "81", type: "bookingStatus" } },
        paymentTerm: { data: { id: paymentTermId, type: "paymentTerm" } },
      },
      attributes: {
        salesChannelId,
        temporary: true,
      },
      type: "Booking",
    },
  };
  const res = http.post(`${BASE_URL}/api/V4.1/bookings`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Create Booking", null, { requestBody: payload });
  const body = res.json() || {};
  return {
    bookingId: body?.data?.id || null,
    contactId: body?.data?.contact?.id || body?.data?.relationships?.contact?.data?.id || null,
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

export function packageSelect(token) {
  const envIds = (__ENV.PACKAGE_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  // const ids = envIds.length ? envIds : [4075, 4079, 4080, 4081, 4082, 4083, 4084, 4085];
  // const ids = envIds.length ? envIds : [3016];uat
  // const ids = envIds.length ? envIds : [4129,4130,4132,4133,4134,4135,4136,4137,4138,4139];
  // const ids = envIds.length ? envIds : [5241,5243,5245,5247,5249,5250,5251,5252];
  const ids = envIds.length ? envIds : [6775,6774,6773,6772,6771,6770,6769,6768,6767,6766];
  const selectedId = ids[Math.floor(Math.random() * ids.length)];
  const res = http.get(`${BASE_URL}/api/V4.1/products/packages/${selectedId}?include=PublicPackage.PackageSessions`, getHeaders(token));
  validate(res, "Package Select", { packageId: selectedId });
  const body = res.json() || {};
  const included = Array.isArray(body?.included) ? body.included : [];
  const sess = included.find((x) => String(x?.type || "").toLowerCase() === "packagesession");
  return {
    packageId: body?.data?.id || String(selectedId),
    pStartDate: sess?.attributes?.startTime || null,
    pEndDate: sess?.attributes?.endTime || null,
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

    validate(res, "Booking Status");

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

export function confirmBooking(token, bookingId) {

  const payload = { data: { attributes: { temporary: false }, id: bookingId, type: "booking" } };
  const res = http.patch(`${BASE_URL}/api/V4.1/bookings/${bookingId}`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Confirm Booking", { bookingId }, { requestBody: payload });
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

export function updateBookingIsPaUserDefinedFieldValue(token, bookingId) {
  const payload = {
    data: {
      relationships: {
        BookingUserDefinedFields: { data: [{ id: 51, type: "BookingUserDefinedField" }] },
      },
      id: bookingId,
      type: "Booking",
    },
    included: [
      {
        relationships: {
          UserDefinedField: { data: { id: 51, type: "UserDefinedField" } },
          UserDefinedFieldValue: { data: { id: 131, type: "UserDefinedFieldValue" } },
        },
        attributes: { Value: "isPA" },
        id: 51,
        type: "BookingUserDefinedField",
      },
    ],
  };
  const res = http.patch(`${BASE_URL}/api/V4.1/bookings/${bookingId}`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Update Booking IsPA", { bookingId }, { requestBody: payload });
  return true;
}

export function getBookingFullDetails(token, bookingId) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings/${bookingId}?include=bookingPackages,paymentTerm,invoices,contact`, getHeaders(token));
  validate(res, "Get Booking Full Details", { bookingId });
  const json = res.json() || {};
  let paymentTermDetailId = null;
  for (const item of json?.included || []) {
    if (String(item?.type || "").toLowerCase() === "paymentterm") {
      paymentTermDetailId = item?.relationships?.paymentTermDetails?.data?.[0]?.id || null;
      if (paymentTermDetailId) break;
    }
  }
  return {
    contactId: json?.data?.relationships?.contact?.data?.id || null,
    paymentTermDetailId,
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