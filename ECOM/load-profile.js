/**
 * ECOM load profiles for k6.
 * Shareable Peak UI profiles live under ECOM/profiles/ (smoke, peak500, peak300).
 * Do not run load until requested — profiles only.
 */

// Shared profiles (ESM-friendly copies; keep in sync with ECOM/profiles/*.js)
const smoke = {
  vus: 1,
  iterations: 1,
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
  peak500: peak500_10m,
  peak500_10m,
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
