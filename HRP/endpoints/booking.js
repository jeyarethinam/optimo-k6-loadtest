import http from "k6/http";
import {
  BASE_URL,
  BOOKING_INCLUDE,
  LIST_INCLUDE,
  HRP_CONTACT_ID,
  HRP_CLIENT_REF,
  HRP_EVENT_MANAGER_ID,
  HRP_PAYMENT_TERM_ID,
  HRP_BOOKING_SOURCE_ID,
  HRP_SALES_CHANNEL_ID,
  HRP_STATUS_DRAFT,
  HRP_STATUS_SUBMITTED,
  HRP_UDF_REQUEST_ID,
  HRP_UDF_PACKAGE_TYPE_ID,
  HRP_UDF_REQUEST_VALUE,
  HRP_UDF_PACKAGE_TYPE_VALUE,
  HRP_EVENT_FROM,
  HRP_EVENT_TO,
  HRP_LIST_STATUS_IDS,
  HRP_CANCEL_REASON_ID,
  resolvePackageIds,
  resolvePackageStartDate,
  uniqueEventName,
  todayYmd,
} from "../data.js";
import { getHeaders, validate } from "../../shared/helpers.js";

function bookingUrl(bookingId) {
  return `${BASE_URL}/api/V4.1/bookings/${bookingId}?include=${encodeURIComponent(BOOKING_INCLUDE)}`;
}

export function listBookings(token) {
  const qs = [
    `include=${encodeURIComponent(LIST_INCLUDE)}`,
    "sort=-BookingDate",
    `filters.clientRef=${encodeURIComponent(HRP_CLIENT_REF)}`,
    `filters.bookingStatusId=${encodeURIComponent(HRP_LIST_STATUS_IDS)}`,
    `filters.eventFromDate=${encodeURIComponent(HRP_EVENT_FROM)}`,
    `filters.eventToDate=${encodeURIComponent(HRP_EVENT_TO)}`,
  ].join("&");
  const res = http.get(`${BASE_URL}/api/V4.1/bookings?${qs}`, getHeaders(token));
  validate(res, "List Bookings");
  const body = res.json() || {};
  const rows = Array.isArray(body?.data) ? body.data : [];
  return { count: rows.length, firstId: rows[0]?.id || null };
}

export function createBooking(token, contactId, eventName) {
  const cid = String(contactId || HRP_CONTACT_ID);
  const payload = {
    data: {
      attributes: {
        bookingSourceId: HRP_BOOKING_SOURCE_ID,
        eventName: eventName || uniqueEventName(__VU || 0, __ITER || 0),
        salesChannelId: HRP_SALES_CHANNEL_ID,
      },
      relationships: {
        bookingPackages: { data: [] },
        bookingStatus: {
          data: { id: HRP_STATUS_DRAFT, relationships: {}, type: "bookingStatus" },
        },
        bookingUserDefinedFields: {
          data: [
            { id: HRP_UDF_REQUEST_ID, relationships: {}, type: "bookingUserDefinedField" },
            { id: HRP_UDF_PACKAGE_TYPE_ID, relationships: {}, type: "bookingUserDefinedField" },
          ],
        },
        contact: {
          data: { id: cid, relationships: {}, type: "contact" },
        },
        eventManager: {
          data: { id: HRP_EVENT_MANAGER_ID, relationships: {}, type: "user" },
        },
        paymentTerm: {
          data: { id: HRP_PAYMENT_TERM_ID, relationships: {}, type: "paymentTerm" },
        },
      },
      type: "booking",
    },
    included: [
      {
        attributes: { value: HRP_UDF_REQUEST_VALUE },
        id: HRP_UDF_REQUEST_ID,
        relationships: {
          userDefinedField: {
            data: { id: HRP_UDF_REQUEST_ID, relationships: {}, type: "userDefinedField" },
          },
        },
        type: "bookingUserDefinedField",
      },
      {
        attributes: { value: HRP_UDF_PACKAGE_TYPE_VALUE },
        id: HRP_UDF_PACKAGE_TYPE_ID,
        relationships: {
          userDefinedField: {
            data: { id: HRP_UDF_PACKAGE_TYPE_ID, relationships: {}, type: "userDefinedField" },
          },
        },
        type: "bookingUserDefinedField",
      },
    ],
  };

  const res = http.post(
    `${BASE_URL}/api/V4.1/bookings?include=${encodeURIComponent(BOOKING_INCLUDE)}`,
    JSON.stringify(payload),
    getHeaders(token)
  );
  validate(res, "Create Booking", { contactId: cid }, { requestBody: payload });
  const body = res.json() || {};
  return {
    bookingId: body?.data?.id || null,
    contactId: body?.data?.relationships?.contact?.data?.id || cid,
    eventName: payload.data.attributes.eventName,
  };
}

export function getBooking(token, bookingId) {
  const res = http.get(bookingUrl(bookingId), getHeaders(token));
  validate(res, "Get Booking", { bookingId });
  const body = res.json() || {};
  return {
    bookingId: body?.data?.id || bookingId,
    statusId: body?.data?.relationships?.bookingStatus?.data?.id || null,
    packageCount: Array.isArray(body?.data?.relationships?.bookingPackages?.data)
      ? body.data.relationships.bookingPackages.data.length
      : 0,
  };
}

export function getNotes(token, bookingId) {
  const res = http.get(`${BASE_URL}/api/V4.1/bookings/${bookingId}/notes`, getHeaders(token));
  validate(res, "Get Notes", { bookingId });
  return true;
}

export function getAuditHistories(token, bookingId) {
  const res = http.get(
    `${BASE_URL}/api/V4.2/bookings/${bookingId}/audit-histories`,
    getHeaders(token)
  );
  // Some envs (e.g. optimodevv5) 500 on empty/new booking audit — do not abort the HRP flow.
  validate(res, "Get Audit Histories", { bookingId }, { continueOnFailure: true });
  return res.status >= 200 && res.status < 300;
}

/**
 * Core HRP load step: PATCH booking with 50 public packages in one request.
 * Package IDs from HRP_PACKAGE_IDS / DEFAULT_PACKAGE_IDS.
 * startDates are resolved dynamically from each package's sessions (same idea as ECOM packageSelect).
 */
export function addFiftyPackages(token, bookingId, contactId, slotIndex = 0, eventName) {
  const packageIds = resolvePackageIds();
  if (packageIds.length !== 50) {
    console.warn(`HRP package id count is ${packageIds.length} (expected 50)`);
  }
  const cid = String(contactId || HRP_CONTACT_ID);
  const relData = [];
  const included = [];
  const resolvedStarts = [];

  // Batch session lookups (chunks of 10). Not counted as flow endpoints — setup for the PATCH.
  const chunkSize = 10;
  const startByPkg = {};
  let sessionsFound = 0;
  for (let offset = 0; offset < packageIds.length; offset += chunkSize) {
    const chunk = packageIds.slice(offset, offset + chunkSize);
    const reqs = chunk.map((pkgId) => ({
      method: "GET",
      url: `${BASE_URL}/api/V4.1/products/packages/${pkgId}?include=PublicPackage.PackageSessions`,
      params: getHeaders(token),
    }));
    const responses = http.batch(reqs);
    for (let j = 0; j < chunk.length; j++) {
      const pkgId = String(chunk[j]);
      const res = responses[j];
      let start = null;
      if (res && res.status >= 200 && res.status < 300) {
        const body = res.json() || {};
        const sessions = (Array.isArray(body?.included) ? body.included : []).filter(
          (x) => String(x?.type || "").toLowerCase() === "packagesession"
        );
        if (sessions.length) {
          const pick = sessions[(offset + j + Number(slotIndex)) % sessions.length];
          start =
            pick?.attributes?.startTime ||
            pick?.attributes?.StartTime ||
            pick?.attributes?.startDate ||
            pick?.attributes?.StartDate ||
            null;
          if (start) sessionsFound += 1;
        }
      }
      startByPkg[pkgId] = start ? String(start) : resolvePackageStartDate(offset + j, slotIndex);
    }
  }
  console.log(
    `HRP_SESSION_RESOLVE bookingId=${bookingId} packages=${packageIds.length} withSessions=${sessionsFound} slot=${slotIndex}`
  );

  for (let i = 0; i < packageIds.length; i++) {
    const negId = String(-(i + 1));
    const pkgId = String(packageIds[i]);
    const startDate = startByPkg[pkgId] || resolvePackageStartDate(i, slotIndex);
    resolvedStarts.push(startDate);
    relData.push({ id: negId, relationships: {}, type: "bookingPackage" });
    included.push({
      attributes: {
        quantity: 1,
        startDate,
      },
      id: negId,
      relationships: {
        package: {
          data: { id: pkgId, relationships: {}, type: "publicPackage" },
        },
        referrerContact: {
          data: { id: cid, relationships: {}, type: "contact" },
        },
      },
      type: "bookingPackage",
    });
  }

  const payload = {
    data: {
      attributes: {
        bookingSourceId: HRP_BOOKING_SOURCE_ID,
        eventName: eventName || uniqueEventName(__VU || 0, __ITER || 0),
        salesChannelId: HRP_SALES_CHANNEL_ID,
      },
      id: String(bookingId),
      relationships: {
        bookingPackages: { data: relData },
      },
      type: "booking",
    },
    included,
  };

  const res = http.patch(bookingUrl(bookingId), JSON.stringify(payload), getHeaders(token));
  validate(
    res,
    "Add 50 Packages",
    { bookingId, packageId: packageIds[0], contactId: cid },
    {
      requestBody: {
        packageCount: packageIds.length,
        firstPackageId: packageIds[0],
        lastPackageId: packageIds[packageIds.length - 1],
        firstStartDate: resolvedStarts[0],
        lastStartDate: resolvedStarts[resolvedStarts.length - 1],
      },
    }
  );
  const body = res.json() || {};
  const pkgRel = body?.data?.relationships?.bookingPackages?.data;
  return {
    bookingId,
    packageCount: Array.isArray(pkgRel) ? pkgRel.length : packageIds.length,
  };
}

export function submitBooking(token, bookingId) {
  const payload = {
    data: {
      id: String(bookingId),
      relationships: {
        bookingStatus: {
          data: { id: HRP_STATUS_SUBMITTED, relationships: {}, type: "bookingStatus" },
        },
      },
      type: "booking",
    },
  };
  const res = http.patch(bookingUrl(bookingId), JSON.stringify(payload), getHeaders(token));
  validate(res, "Submit Booking", { bookingId }, { requestBody: payload });
  return true;
}

export function unsubmitBooking(token, bookingId) {
  const payload = {
    data: {
      id: String(bookingId),
      relationships: {
        bookingStatus: {
          data: { id: HRP_STATUS_DRAFT, relationships: {}, type: "bookingStatus" },
        },
      },
      type: "booking",
    },
  };
  const res = http.patch(bookingUrl(bookingId), JSON.stringify(payload), getHeaders(token));
  validate(res, "Unsubmit Booking", { bookingId }, { requestBody: payload });
  return true;
}

export function cancelBooking(token, bookingId) {
  const payload = {
    data: {
      attributes: {
        cancellationFee: "0",
        cancellationReasonId: HRP_CANCEL_REASON_ID,
        cancelled: true,
        cancelledDate: todayYmd(),
        note: "Cancelled by HRP k6 load test",
      },
      id: String(bookingId),
      relationships: {},
      type: "booking",
    },
  };
  const res = http.post(
    `${BASE_URL}/api/V4.1/bookings/${bookingId}/cancel-booking`,
    JSON.stringify(payload),
    getHeaders(token)
  );
  validate(res, "Cancel Booking", { bookingId }, { requestBody: payload });
  return true;
}
