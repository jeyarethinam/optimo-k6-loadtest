/**
 * ECOM load profiles for k6.
 * Shareable Peak UI profiles live under ECOM/profiles/ (smoke, peak10, peak50, peak100, peak120, peak300, peak500, peak1000).
 * Do not run load until requested — profiles only.
 */

// Shared profiles (ESM-friendly copies; keep in sync with ECOM/profiles/*.js)
const smoke = {
  vus: 1,
  iterations: 1,
};

// Peak 10 / 1m — constant 10 VUs
const peak10_1m = {
  vus: 10,
  duration: "1m",
};

// Peak 50 / 10m / base 10 (UI screenshot)
const peak50 = {
  stages: [
    { duration: "2m", target: 10 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 10 },
    { duration: "2m", target: 10 },
  ],
};

// Peak 100 / 10m / base 20 (UI screenshot)
const peak100 = {
  stages: [
    { duration: "2m", target: 20 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 20 },
    { duration: "2m", target: 20 },
  ],
};

// Peak 120 / 10m / base 24 (same shape as peak100)
const peak120 = {
  stages: [
    { duration: "2m", target: 24 },
    { duration: "2m", target: 120 },
    { duration: "2m", target: 120 },
    { duration: "2m", target: 24 },
    { duration: "2m", target: 24 },
  ],
};

// Peak 500 / 10m / base 100 (UI screenshot)
const peak500_10m = {
  stages: [
    { duration: "2m", target: 100 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 100 },
  ],
};

// Peak 1000 / 10m / base 200 (UI screenshot)
const peak1000 = {
  stages: [
    { duration: "2m", target: 200 },
    { duration: "2m", target: 1000 },
    { duration: "2m", target: 1000 },
    { duration: "2m", target: 200 },
    { duration: "2m", target: 200 },
  ],
};

// Peak 300 / 10m / base 60 (UI screenshot)
const peak300 = {
  stages: [
    { duration: "2m", target: 60 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 60 },
    { duration: "2m", target: 60 },
  ],
};

export const loadProfile = {
  smoke,

  // Alias for clarity when sharing
  peak10: peak10_1m,
  peak10_1m,
  peak50,
  peak50_10m: peak50,
  peak100,
  peak100_ui: peak100,
  peak120,
  peak500: peak500_10m,
  peak500_10m,
  peak1000,
  peak1000_10m: peak1000,
  peak300,
  peak300_10m: peak300,

  // Legacy short peak profile.
  peak: {
    stages: [
      { duration: "2m", target: 20 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 20 },
    ],
  },

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

  peak100_constant_10m: {
    vus: 100,
    duration: "10m",
  },

  peak500_constant_10m: {
    vus: 500,
    duration: "10m",
  },

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
