export const loadProfile = {
  smoke: {
    vus: 1,
    iterations: 1,
  },

  // 120 VU peak — 10 minute client-facing window
  // 2m ramp → 120, 6m hold, 2m ramp down
  peak120_10m: {
    stages: [
      { duration: "2m", target: 120 },
      { duration: "6m", target: 120 },
      { duration: "2m", target: 0 },
    ],
  },

  // Softer ramp into 120 VU (better for first peak runs)
  peak120: {
    stages: [
      { duration: "2m", target: 30 },
      { duration: "2m", target: 60 },
      { duration: "2m", target: 120 },
      { duration: "4m", target: 120 },
      { duration: "2m", target: 60 },
      { duration: "2m", target: 0 },
    ],
  },

  // Flat 120 VU for 10 minutes (pure peak percentiles)
  peak120_constant_10m: {
    vus: 120,
    duration: "10m",
  },

  // Smaller soak before jumping to 120
  peak20_10m: {
    stages: [
      { duration: "2m", target: 4 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 4 },
      { duration: "2m", target: 4 },
    ],
  },
};
