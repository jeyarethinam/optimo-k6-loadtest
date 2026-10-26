/**
 * NSC load profiles for k6.
 * Shareable UI profiles under NSC/profiles/ (smoke, vu2, vu3, peak*).
 */

const smoke = {
  vus: 1,
  iterations: 1,
};

/** Historical two-user sustained write comparison (Oct 2026). */
const vu2 = {
  scenarios: {
    booking_journey: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 1 },
        { duration: "30s", target: 2 },
        { duration: "5m", target: 2 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
};

/** Historical three-user sustained write (Oct 2026). */
const vu3 = {
  scenarios: {
    booking_journey: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 1 },
        { duration: "30s", target: 2 },
        { duration: "30s", target: 3 },
        { duration: "5m", target: 3 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
};

/** Historical three-user diagnostic (shorter hold). */
const vu3_diagnostic = {
  scenarios: {
    booking_journey: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 1 },
        { duration: "30s", target: 2 },
        { duration: "30s", target: 3 },
        { duration: "2m", target: 3 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
};

const peak10_1m = { vus: 10, duration: "1m" };

const peak50 = {
  stages: [
    { duration: "2m", target: 10 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 10 },
    { duration: "2m", target: 10 },
  ],
};

const peak100 = {
  stages: [
    { duration: "2m", target: 20 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 20 },
    { duration: "2m", target: 20 },
  ],
};

const peak120 = {
  stages: [
    { duration: "2m", target: 24 },
    { duration: "2m", target: 120 },
    { duration: "2m", target: 120 },
    { duration: "2m", target: 24 },
    { duration: "2m", target: 24 },
  ],
};

const peak300 = {
  stages: [
    { duration: "2m", target: 60 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 60 },
    { duration: "2m", target: 60 },
  ],
};

const peak500_10m = {
  stages: [
    { duration: "2m", target: 100 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 100 },
  ],
};

const peak1000 = {
  stages: [
    { duration: "2m", target: 200 },
    { duration: "2m", target: 1000 },
    { duration: "2m", target: 1000 },
    { duration: "2m", target: 200 },
    { duration: "2m", target: 200 },
  ],
};

export const loadProfile = {
  smoke,
  vu2,
  vu2_sustained: vu2,
  vu3,
  vu3_sustained: vu3,
  vu3_diagnostic,
  peak10: peak10_1m,
  peak10_1m,
  peak50,
  peak50_10m: peak50,
  peak100,
  peak100_ui: peak100,
  peak120,
  peak300,
  peak300_10m: peak300,
  peak500: peak500_10m,
  peak500_10m,
  peak1000,
  peak1000_10m: peak1000,
  peak: peak100,
  peak100_sustained: {
    stages: [
      { duration: "5m", target: 20 },
      { duration: "5m", target: 60 },
      { duration: "5m", target: 100 },
      { duration: "25m", target: 100 },
      { duration: "5m", target: 60 },
      { duration: "5m", target: 20 },
      { duration: "5m", target: 0 },
    ],
  },
  peak100_10m: {
    stages: [
      { duration: "2m", target: 100 },
      { duration: "6m", target: 100 },
      { duration: "2m", target: 0 },
    ],
  },
  peak100_constant_10m: { vus: 100, duration: "10m" },
  peak500_constant_10m: { vus: 500, duration: "10m" },
  peak20_10m: {
    stages: [
      { duration: "2m", target: 4 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 4 },
      { duration: "2m", target: 4 },
    ],
  },
  peak50_5m: {
    stages: [
      { duration: "1m", target: 50 },
      { duration: "3m", target: 50 },
      { duration: "1m", target: 0 },
    ],
  },
  peak200: {
    stages: [
      { duration: "2m", target: 40 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 40 },
      { duration: "2m", target: 40 },
    ],
  },
  peak400: {
    stages: [
      { duration: "2m", target: 80 },
      { duration: "2m", target: 400 },
      { duration: "2m", target: 400 },
      { duration: "2m", target: 80 },
      { duration: "2m", target: 80 },
    ],
  },
};
