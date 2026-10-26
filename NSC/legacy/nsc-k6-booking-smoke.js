// One-user booking smoke: login → draft → Enquiry. Credentials via env only.
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const runId = __ENV.NSC_SMOKE_RUN_ID || 'NSC-SMOKE-LOCAL';
const bookingCap = 1;
const fromDate = __ENV.NSC_SMOKE_FROM_DATE || '2026-11-03';
const toDate = __ENV.NSC_SMOKE_TO_DATE || '2026-11-10';
const scanDays = Number(__ENV.NSC_SMOKE_SCAN_DAYS || 7);

export const options = {
  noCookiesReset: true,
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<5000'],
    'http_req_duration{name:submit_enquiry}': ['p(95)<6000'],
  },
};

const origin = __ENV.NSC_ORIGIN || 'https://nsc-play-booking-portal.azurewebsites.net';
const base = origin + '/bookingportal/api';

function assert(ok, label) {
  if (!check(null, { [label]: () => Boolean(ok) })) exec.test.abort(label);
}

function request(method, path, name, body) {
  const r = http.request(method, base + path, body === undefined ? null : JSON.stringify(body), {
    redirects: 0,
    timeout: '25s',
    tags: { name },
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: origin,
    },
  });
  let p;
  try {
    p = r.json();
  } catch (_) {
    p = null;
  }
  console.log(
    JSON.stringify({
      runId,
      vu: __VU,
      step: name,
      status: r.status,
      durationMs: Math.round(r.timings.duration),
    })
  );
  if (
    !check(r, {
      [`${name} succeeds`]: (x) => x.status >= 200 && x.status < 300 && p && p.success !== false,
    })
  ) {
    console.log(
      JSON.stringify({
        runId,
        vu: __VU,
        step: name,
        event: 'failure_body',
        body: (r.body || '').slice(0, 800),
      })
    );
    exec.test.abort(name + ' failed');
  }
  sleep(0.25);
  return p.data;
}

export default function () {
  if (__ENV.NSC_ALLOW_SMOKE_RUN !== runId || __ENV.NSC_MAX_BOOKINGS !== String(bookingCap)) {
    exec.test.abort('Exact smoke run token and 1-booking cap are required');
  }
  const email = __ENV.NSC_TEST_EMAIL_1;
  if (!email) exec.test.abort('NSC_TEST_EMAIL_1 is required');
  if (!__ENV.NSC_TEST_PASSWORD) exec.test.abort('NSC_TEST_PASSWORD must be supplied through process environment');

  const iterationStart = Date.now();

  const login = request('POST', '/customers/login', 'login', {
    email,
    password: __ENV.NSC_TEST_PASSWORD,
  });
  assert(login != null, 'login response present');

  const me = request('GET', '/customers/me', 'identity');
  assert(
    me?.id && me.email && String(me.email).toLowerCase() === String(email).toLowerCase() && me.phone && me.concessionGroupId,
    'authenticated identity complete'
  );

  const asset = request('GET', '/assets/586', 'asset');
  assert(String(asset?.id) === '586', 'expected booking space');

  const packages = request('GET', '/products/private-packages?assetId=586', 'packages');
  // Historical UAT used package 113 (Ceremonies Test Package); current catalogue uses 58.
  const pkg =
    packages.find((p) => String(p.id) === '58') ||
    packages.find((p) => String(p.id) === '113') ||
    packages.find((p) => /ceremon/i.test(p.name || '') && p.isEligible && (!p.packageItems || p.packageItems.length === 0));
  assert(pkg?.isEligible && (!pkg.packageItems || pkg.packageItems.length === 0), 'known package workflow eligible');
  console.log(JSON.stringify({ runId, vu: __VU, event: 'package_selected', id: pkg.id, name: pkg.name }));

  const items = request(
    'GET',
    '/products/items?assetId=586&salesCategoryId=' + pkg.salesCategories.map((c) => c.id).join(','),
    'items'
  );
  const item = items.find((i) => String(i.id) === '2156');
  assert(
    item?.assetIds?.includes('586') && item.allowImmediateConfirmedBookings === false,
    'approval-required low-impact item available'
  );

  const slots = request(
    'GET',
    `/timeslots?assetIds=586&fromDate=${fromDate}&toDate=${toDate}`,
    'availability'
  );
  assert(Array.isArray(slots), 'availability returned an array');

  const startDay = new Date(fromDate + 'T00:00:00.000Z');
  let chosen = null;
  let date = null;
  for (let offset = 0; offset < scanDays && !chosen; offset++) {
    const day = new Date(startDay.getTime() + offset * 86400000);
    const candidateDate = day.toISOString().slice(0, 10);
    for (let minutes = 8 * 60; minutes < 18 * 60; minutes += 30) {
      const fmt = (m) =>
        String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const candidate = { startTime: fmt(minutes), endTime: fmt(minutes + 30) };
      const startIso = candidateDate + 'T' + candidate.startTime + ':00';
      const endIso = candidateDate + 'T' + candidate.endTime + ':00';
      if (!slots.some((s) => s.startTime < endIso && s.endTime > startIso)) {
        chosen = candidate;
        date = candidateDate;
        break;
      }
    }
  }
  assert(chosen, 'available half-hour slot exists in smoke date window');

  const start = date + 'T' + chosen.startTime + ':00';
  const end = date + 'T' + chosen.endTime + ':00';
  assert(!slots.some((s) => s.startTime < end && s.endTime > start), 'selected slot has no overlap');

  const price = request(
    'GET',
    `/products/items/2156/calculated-price?startTime=${start}&endTime=${end}&quantity=1&priceConcessionId=${encodeURIComponent(me.concessionGroupId)}`,
    'price'
  );
  assert(
    price?.totalPrice === 0 && String(price.concessionId) === String(me.concessionGroupId),
    'selected journey is zero-cost'
  );

  const { totalPrice, totalPriceExcludingTax, priceType, occurrences, ...calculatedPriceGroup } = price;
  const bookingName = `${runId}-VU1-I1`;
  const payload = {
    booking: {
      bookingName,
      summary: { subtotal: 0, discount: 0, fees: 0, total: 0, itemCount: 1, requiresApproval: true },
      isTemporary: true,
      canBookAndPay: false,
      demographicsQuestionnaireId: null,
    },
    extras: [],
    removedExtraIds: [],
    items: [
      {
        cartItemId: bookingName + '-item-1',
        bookingType: 'casual',
        activity: pkg.name,
        activityId: pkg.id,
        attendees: 1,
        bookingPackageId: null,
        spaceId: asset.primaryId ?? asset.id,
        itemId: item.id,
        itemType: item.itemType,
        scheduledDates: [
          {
            date: date + 'T00:00:00.000',
            startTime: chosen.startTime,
            endTime: chosen.endTime,
            status: 'available',
          },
        ],
        recurrenceOption: null,
        pricing: { basePrice: 0, totalPrice: 0, priceType: 'period' },
        calculatedPriceGroup,
      },
    ],
  };

  console.log(
    JSON.stringify({
      runId,
      vu: __VU,
      event: 'create_attempt',
      bookingName,
      date,
      startTime: chosen.startTime,
      endTime: chosen.endTime,
      maximumTotalBookings: bookingCap,
      retryAllowed: false,
    })
  );

  const created = request('POST', '/bookings', 'create_draft', payload);
  console.log(
    JSON.stringify({
      runId,
      vu: __VU,
      event: 'created',
      bookingId: created?.bookingId,
      reference: created?.bookingReference,
      bookingName,
    })
  );
  assert(created?.bookingId && created.bookingReference, 'booking identifier and reference returned');

  const id = encodeURIComponent(created.bookingId);
  request('PATCH', '/bookings/' + id, 'submit_enquiry', {
    booking: {
      id: created.bookingId,
      bookingName,
      customerId: me.id,
      customer: {
        fullName: me.displayName || [me.firstName, me.lastName].filter(Boolean).join(' '),
        email: me.email,
        phone: me.phone,
      },
      isTemporary: false,
      specialRequirements: null,
      postSpecialRequirementsNote: false,
      smsUpdates: false,
      agreedToTerms: true,
      bookingStatus: 'pending',
    },
    items: [],
    priceConcessionId: me.concessionGroupId,
  });

  const booking = request(
    'GET',
    '/bookings/' + id + '?includes=bookingStatus,bookingPackages,bookingItems,Allocations,Timeslot',
    'confirmation'
  );
  console.log(
    JSON.stringify({
      runId,
      vu: __VU,
      event: 'confirmed',
      bookingId: created.bookingId,
      reference: created.bookingReference,
      status: booking?.bookingStatus,
      totalAmount: booking?.totalAmount,
      isTemporary: booking?.isTemporary,
    })
  );

  assert(
    String(booking?.id) === String(created.bookingId) && booking.bookingReference === created.bookingReference,
    'retrieved booking matches creation'
  );
  assert(booking.totalAmount === 0, 'persisted booking is zero-cost');
  assert(
    String(booking.bookingStatus?.id) === '53' && booking.bookingStatus?.name === 'Enquiry',
    'persisted status is Enquiry'
  );

  console.log(
    JSON.stringify({
      runId,
      vu: __VU,
      event: 'smoke_ok',
      journeySeconds: (Date.now() - iterationStart) / 1000,
      bookingId: created.bookingId,
      reference: created.bookingReference,
    })
  );
}

export function handleSummary(data) {
  return { [`nsc-k6-booking-smoke-results-${runId}.json`]: JSON.stringify(data, null, 2) };
}
