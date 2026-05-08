/**
 * flow_step order for HTML report table and endpoint_* thresholds.
 * Aligned to `postman/WCC-Booking-dynamic.postman_collection.json` (simple folder + complex folder).
 */

const SIMPLE_STEPS = [
  ["WCC_Simple_00_Login", "POST", "WCC Login (simple)"],
  ["WCC_Simple_01_First10Bookings", "GET", "WCC Simple GET First 10 Bookings"],
  ["WCC_Simple_02_UserDefinedFields", "GET", "WCC Simple GET user-defined-fields"],
  ["WCC_Simple_03_BusinessAreas", "GET", "WCC Simple GET business-areas"],
  ["WCC_Simple_04_ClientTypes", "GET", "WCC Simple GET client-types"],
  ["WCC_Simple_05_GetUser", "GET", "WCC Simple GET User (REST JSON:API — Postman SPA uses cookies)"],
  ["WCC_Simple_06_GetContact", "GET", "WCC Simple GET Contact"],
  ["WCC_Simple_07_CreateEmptyBooking", "POST", "WCC Simple Create Empty Booking"],
  ["WCC_Simple_08_BookingPayments", "GET", "WCC Simple GET Booking Payment"],
  ["WCC_Simple_09_PaymentMethods", "GET", "WCC Simple GET Payment-Methods"],
  ["WCC_Simple_10_EligibleDocuments", "GET", "WCC Simple GET booking eligible-documents"],
  ["WCC_Simple_11_BookingDetails", "GET", "WCC Simple GET booking-details (SPA)"],
  ["WCC_Simple_12_GetClient", "GET", "WCC Simple GET Client"],
  ["WCC_Simple_13_BookingDocuments", "GET", "WCC Simple GET Booking Documents"],
  ["WCC_Simple_14_EntityProfileDetails", "GET", "WCC Simple Entity-configurations profile-details"],
  ["WCC_Simple_15_CancellationPolicySchedule", "GET", "WCC Simple GET Cancellation-policy-schedule"],
  ["WCC_Simple_16_BookingStatuses", "GET", "WCC Simple GET Booking Booking-statuses"],
  ["WCC_Simple_17_BookingNotes", "GET", "WCC Simple GET Booking Notes"],
  ["WCC_Simple_18_BookingInvoices", "GET", "WCC Simple GET Booking Invoices"],
  ["WCC_Simple_19_PaymentSchedule", "GET", "WCC Simple GET Booking Payment-Schedule"],
  ["WCC_Simple_20_ClientCreate", "POST", "WCC Simple Client Create"],
  ["WCC_Simple_21_AddClientToBooking", "PATCH", "WCC Simple Add Client to Booking"],
  ["WCC_Simple_22_AddPackage", "PATCH", "WCC Simple Add Package to booking"],
  ["WCC_Simple_23_AddUpsell", "PATCH", "WCC Simple Add Upsell to booking Package"],
  ["WCC_Simple_24_ConfirmBooking", "PATCH", "WCC Simple Confirm Booking"],
  ["WCC_Simple_24_ConfirmSkipped", "GET", "WCC Simple Confirm Skipped — GET booking"],
  ["WCC_Simple_25_ModifyBookingItemPrice", "PATCH", "WCC Simple Modify the booking item price"],
  ["WCC_Simple_26a_PreInvoiceBookingGET", "GET", "WCC Simple pre-invoice booking GET"],
  ["WCC_Simple_26_InvoiceCreate", "POST", "WCC Simple Invoice Create"],
  ["WCC_Simple_27_CreatePayment", "POST", "WCC Simple Create Payment"],
  ["WCC_Simple_28_AddBookingNote", "POST", "WCC Simple Add Booking Note"],
  ["WCC_Simple_29_BookingItemGET", "GET", "WCC Simple Booking Item GET"],
  ["WCC_Simple_30_AddBookingTask", "POST", "WCC Simple Add Booking Task"],
];

const COMPLEX_STEPS = [
  ["WCC_Complex_00_Login", "POST", "WCC Login (complex)"],
  ["WCC_Complex_01_CreateDailyRecurring", "POST", "WCC Complex Create Daily Recurring -5 Days"],
  ["WCC_Complex_02_AddClient", "PATCH", "WCC Complex Add Client"],
  ["WCC_Complex_02b_ConfirmBooking", "PATCH", "WCC Complex Confirm Booking"],
  ["WCC_Complex_03a_PreInvoiceBookingGET", "GET", "WCC Complex pre-invoice booking GET"],
  ["WCC_Complex_03_InvoiceCreate", "POST", "WCC Complex Invoice Create"],
  ["WCC_Complex_04_Payment", "POST", "WCC Complex Payment"],
  ["WCC_Complex_05_AddBookingNote", "POST", "WCC Complex Add Booking Note"],
  ["WCC_Complex_06_AddBookingTask", "POST", "WCC Complex Add Booking Task"],
];

const META = new Map();
for (const [step, method, endpoint] of [...SIMPLE_STEPS, ...COMPLEX_STEPS]) {
  META.set(step, { method, endpoint });
}

export const WCC_REPORT_FLOW_STEP_ORDER = [
  ...SIMPLE_STEPS.map((r) => r[0]),
  ...COMPLEX_STEPS.map((r) => r[0]),
];

export function getWccStepMeta(step) {
  const m = META.get(step);
  if (m) return { endpoint: m.endpoint, method: m.method };
  return { endpoint: step, method: "N/A" };
}
