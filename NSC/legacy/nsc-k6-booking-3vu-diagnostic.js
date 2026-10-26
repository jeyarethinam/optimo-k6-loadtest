// SANITIZED COPY OF RECOVERED ORIGINAL. See README.md and provenance.json; not executed during recovery.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const runId = 'SANITIZED-3VU-DIAGNOSTIC-RUN-ID';
const pacingSeconds = 15;
const iterationsPerUser = 4;
const bookingCap = 12;

export const options = {
  noCookiesReset: true,
  scenarios: {
    booking_journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 1 },
        { duration: '30s', target: 2 },
        { duration: '30s', target: 3 },
        { duration: '2m', target: 3 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<3000'],
    'http_req_duration{name:submit_enquiry}': ['p(95)<4500'],
  },
};

const origin = 'https://example.invalid';
const base = origin + '/bookingportal/api';
const testUsers = [
  { email: __ENV.NSC_TEST_EMAIL_1, fromDate: '2026-11-03', toDate: '2026-11-08', days: 5, offset: 0 },
  { email: __ENV.NSC_TEST_EMAIL_2, fromDate: '2026-11-08', toDate: '2026-11-13', days: 5, offset: 5 },
  { email: __ENV.NSC_TEST_EMAIL_3, fromDate: '2026-11-13', toDate: '2026-11-17', days: 4, offset: 10 },
];

function assert(ok, label) {
  if (!check(null, { [label]: () => Boolean(ok) })) exec.test.abort(label);
}

function request(method, path, name, body) {
  const response = http.request(method, base + path, body === undefined ? null : JSON.stringify(body), {
    redirects: 0,
    timeout: '25s',
    tags: { name },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: origin },
  });
  let parsed;
  try { parsed = response.json(); } catch (_) { parsed = null; }
  console.log(JSON.stringify({ runId, vu: __VU, step: name, status: response.status, durationMs: Math.round(response.timings.duration) }));
  if (!check(response, { [`${name} succeeds`]: r => r.status >= 200 && r.status < 300 && parsed && parsed.success !== false })) {
    exec.test.abort(`${name} failed; stopping immediately`);
  }
  sleep(0.25);
  return parsed.data;
}

export default function () {
  if (__ENV.NSC_ALLOW_THREE_USER_DIAGNOSTIC !== runId || __ENV.NSC_MAX_BOOKINGS !== String(bookingCap)) {
    exec.test.abort('Exact diagnostic token and 12-booking cap are required');
  }
  for (const n of [1, 2, 3]) if (!__ENV[`NSC_TEST_EMAIL_${n}`]) exec.test.abort(`Test account ${n} is required`);
  if (!__ENV.NSC_TEST_PASSWORD) exec.test.abort('Test-account password must be supplied transiently');
  if (__VU < 1 || __VU > 3) exec.test.abort('Hard ceiling: three virtual users');
  if (exec.vu.iterationInScenario >= iterationsPerUser) { sleep(1); return; }

  const iterationStart = Date.now();
  if (exec.vu.iterationInScenario === 0) sleep((__VU - 1) * pacingSeconds / 2);
  const user = testUsers[__VU - 1];

  const login = request('POST', '/customers/login', 'login', { email: user.email, password: __ENV.NSC_TEST_PASSWORD });
  assert(login != null, 'login response present');
  const me = request('GET', '/customers/me', 'identity');
  assert(me?.id && me.email === user.email && me.phone && me.concessionGroupId, 'authenticated dedicated identity complete');
  const asset = request('GET', '/assets/586', 'asset');
  assert(String(asset?.id) === '586', 'expected booking space');
  const packages = request('GET', '/products/private-packages?assetId=586', 'packages');
  const pkg = packages.find(p => p.id === '113' && p.name === 'Ceremonies Test Package');
  assert(pkg?.isEligible && pkg.packageItems.length === 0, 'known package workflow eligible');
  const items = request('GET', '/products/items?assetId=586&salesCategoryId=' + pkg.salesCategories.map(c => c.id).join(','), 'items');
  const item = items.find(i => i.id === '2156');
  assert(item?.assetIds?.includes('586') && item.allowImmediateConfirmedBookings === false, 'approval-required low-impact item available');

  const slots = request('GET', `/timeslots?assetIds=586&fromDate=${user.fromDate}&toDate=${user.toDate}`, 'availability');
  assert(Array.isArray(slots), 'availability returned an array');
  let chosen = null;
  let date = null;
  for (let offset = 0; offset < user.days && !chosen; offset++) {
    const candidateDate = new Date(Date.UTC(2026, 10, 3 + user.offset + offset)).toISOString().slice(0, 10);
    for (let minutes = 8 * 60; minutes < 18 * 60; minutes += 30) {
      const format = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const candidate = { startTime: format(minutes), endTime: format(minutes + 30) };
      if (!slots.some(s => s.startTime < candidateDate + 'T' + candidate.endTime + ':00' && s.endTime > candidateDate + 'T' + candidate.startTime + ':00')) {
        chosen = candidate;
        date = candidateDate;
        break;
      }
    }
  }
  assert(chosen, 'available half-hour slot exists in this user date partition');
  const start = date + 'T' + chosen.startTime + ':00';
  const end = date + 'T' + chosen.endTime + ':00';
  assert(!slots.some(s => s.startTime < end && s.endTime > start), 'selected slot has no overlap');
  const price = request('GET', `/products/items/2156/calculated-price?startTime=${start}&endTime=${end}&quantity=1&priceConcessionId=${encodeURIComponent(me.concessionGroupId)}`, 'price');
  assert(price?.totalPrice === 0 && String(price.concessionId) === String(me.concessionGroupId), 'selected journey is zero-cost');

  const { totalPrice, totalPriceExcludingTax, priceType, occurrences, ...calculatedPriceGroup } = price;
  const bookingName = `${runId}-VU${__VU}-I${exec.vu.iterationInScenario + 1}`;
  const payload = {
    booking: { bookingName, summary: { subtotal: 0, discount: 0, fees: 0, total: 0, itemCount: 1, requiresApproval: true }, isTemporary: true, canBookAndPay: false, demographicsQuestionnaireId: null },
    extras: [], removedExtraIds: [],
    items: [{ cartItemId: bookingName + '-item-1', bookingType: 'casual', activity: pkg.name, activityId: pkg.id, attendees: 1,
      bookingPackageId: null, spaceId: asset.primaryId ?? asset.id, itemId: item.id, itemType: item.itemType,
      scheduledDates: [{ date: date + 'T00:00:00.000', startTime: chosen.startTime, endTime: chosen.endTime, status: 'available' }],
      recurrenceOption: null, pricing: { basePrice: 0, totalPrice: 0, priceType: 'period' }, calculatedPriceGroup }],
  };
  console.log(JSON.stringify({ runId, vu: __VU, event: 'create_attempt', bookingName, date, startTime: chosen.startTime, endTime: chosen.endTime,
    maximumTotalBookings: bookingCap, retryAllowed: false }));
  const created = request('POST', '/bookings', 'create_draft', payload);
  assert(created?.bookingId && created.bookingReference, 'booking identifier and reference returned');
  console.log(JSON.stringify({ runId, vu: __VU, event: 'created', bookingId: created.bookingId, reference: created.bookingReference, bookingName }));
  const id = encodeURIComponent(created.bookingId);
  request('PATCH', '/bookings/' + id, 'submit_enquiry', {
    booking: { id: created.bookingId, bookingName, customerId: me.id,
      customer: { fullName: me.displayName || [me.firstName, me.lastName].filter(Boolean).join(' '), email: me.email, phone: me.phone },
      isTemporary: false, specialRequirements: null, postSpecialRequirementsNote: false,
      smsUpdates: false, agreedToTerms: true, bookingStatus: 'pending' },
    items: [], priceConcessionId: me.concessionGroupId,
  });
  const booking = request('GET', '/bookings/' + id + '?includes=bookingStatus,bookingPackages,bookingItems,Allocations,Timeslot', 'confirmation');
  assert(String(booking?.id) === String(created.bookingId) && booking.bookingReference === created.bookingReference, 'retrieved booking matches creation');
  assert(booking.totalAmount === 0, 'persisted booking is zero-cost');
  assert(String(booking.bookingStatus?.id) === '53' && booking.bookingStatus?.name === 'Enquiry', 'persisted status is Enquiry');
  console.log(JSON.stringify({ runId, vu: __VU, event: 'confirmed', bookingId: created.bookingId, reference: created.bookingReference,
    status: booking.bookingStatus, totalAmount: booking.totalAmount }));

  const targetSeconds = exec.vu.iterationInScenario === 0 ? pacingSeconds + (__VU - 1) * pacingSeconds / 2 : pacingSeconds;
  const elapsed = (Date.now() - iterationStart) / 1000;
  sleep(Math.max(0, targetSeconds - elapsed));
}

export function handleSummary(data) {
  return { [`nsc-k6-booking-3vu-results-${runId}.json`]: JSON.stringify(data, null, 2) };
}
