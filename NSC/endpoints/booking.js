import http from "k6/http";
import { API_BASE, jsonHeaders } from "../data.js";
import { validate, REQUEST_TIMEOUT } from "../../shared/helpers.js";

function assertAppSuccess(res, name, context, options) {
  validate(res, name, context, options);
  let body;
  try {
    body = res.json();
  } catch (_) {
    throw new Error(`${name}: response is not JSON`);
  }
  if (body && body.success === false) {
    const err = new Error(`${name}: API success=false`);
    err.k6Failure = {
      endpoint: name,
      status: res.status,
      responseBody: res.body,
      ...(context || {}),
    };
    throw err;
  }
  return body && body.data !== undefined ? body.data : body;
}

export function createDraftBooking({ bookingName, asset, pkg, item, slot, price }) {
  const { totalPrice, totalPriceExcludingTax, priceType, occurrences, ...calculatedPriceGroup } =
    price;
  const payload = {
    booking: {
      bookingName,
      summary: {
        subtotal: 0,
        discount: 0,
        fees: 0,
        total: 0,
        itemCount: 1,
        requiresApproval: true,
      },
      isTemporary: true,
      canBookAndPay: false,
      demographicsQuestionnaireId: null,
    },
    extras: [],
    removedExtraIds: [],
    items: [
      {
        cartItemId: bookingName + "-item-1",
        bookingType: "casual",
        activity: pkg.name,
        activityId: pkg.id,
        attendees: 1,
        bookingPackageId: null,
        spaceId: asset.primaryId ?? asset.id,
        itemId: item.id,
        itemType: item.itemType,
        scheduledDates: [
          {
            date: slot.date + "T00:00:00.000",
            startTime: slot.startTime,
            endTime: slot.endTime,
            status: "available",
          },
        ],
        recurrenceOption: null,
        pricing: { basePrice: 0, totalPrice: 0, priceType: "period" },
        calculatedPriceGroup,
      },
    ],
  };
  const body = JSON.stringify(payload);
  const res = http.post(API_BASE + "/bookings", body, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "create_draft" },
  });
  const created = assertAppSuccess(res, "CreateDraft", { bookingName, packageId: pkg.id }, { requestBody: body });
  if (!created?.bookingId || !created.bookingReference) {
    throw new Error("CreateDraft missing bookingId/reference");
  }
  return created;
}

export function submitEnquiry({ bookingId, bookingName, me }) {
  const payload = {
    booking: {
      id: bookingId,
      bookingName,
      customerId: me.id,
      customer: {
        fullName: me.displayName || [me.firstName, me.lastName].filter(Boolean).join(" "),
        email: me.email,
        phone: me.phone,
      },
      isTemporary: false,
      specialRequirements: null,
      postSpecialRequirementsNote: false,
      smsUpdates: false,
      agreedToTerms: true,
      bookingStatus: "pending",
    },
    items: [],
    priceConcessionId: me.concessionGroupId,
  };
  const body = JSON.stringify(payload);
  const id = encodeURIComponent(bookingId);
  const res = http.patch(API_BASE + "/bookings/" + id, body, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "submit_enquiry" },
  });
  return assertAppSuccess(res, "SubmitEnquiry", { bookingId }, { requestBody: body });
}

export function getBookingConfirmation(bookingId) {
  const id = encodeURIComponent(bookingId);
  const res = http.get(
    API_BASE +
      "/bookings/" +
      id +
      "?includes=bookingStatus,bookingPackages,bookingItems,Allocations,Timeslot",
    {
      headers: jsonHeaders,
      redirects: 0,
      timeout: REQUEST_TIMEOUT,
      tags: { name: "confirmation" },
    }
  );
  return assertAppSuccess(res, "Confirmation", { bookingId });
}

export function assertEnquiryZeroCost(booking, created) {
  if (String(booking?.id) !== String(created.bookingId)) {
    throw new Error("Confirmation booking id mismatch");
  }
  if (booking.bookingReference !== created.bookingReference) {
    throw new Error("Confirmation booking reference mismatch");
  }
  if (booking.totalAmount !== 0) {
    throw new Error(`Expected totalAmount 0, got ${booking.totalAmount}`);
  }
  if (String(booking.bookingStatus?.id) !== "53" || booking.bookingStatus?.name !== "Enquiry") {
    throw new Error(
      `Expected Enquiry status 53, got ${booking.bookingStatus?.id}/${booking.bookingStatus?.name}`
    );
  }
}
