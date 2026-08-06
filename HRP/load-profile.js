export const loadProfile = {
  smoke: {
    vus: 1,
    iterations: 1,
  },

  // Matches Peak UI: 120 VUs, 10 mins, base load 24
  // 2m @ 24 → 2m ramp to 120 → 2m @ 120 → 2m ramp to 24 → 2m @ 24
  peak120_10m: {
    stages: [
      { duration: "2m", target: 24 },
      { duration: "2m", target: 120 },
      { duration: "2m", target: 120 },
      { duration: "2m", target: 24 },
      { duration: "2m", target: 24 },
    ],
  },

  // Alias of Peak UI profile (same wave)
  peak120: {
    stages: [
      { duration: "2m", target: 24 },
      { duration: "2m", target: 120 },
      { duration: "2m", target: 120 },
      { duration: "2m", target: 24 },
      { duration: "2m", target: 24 },
    ],
  },

  // Flat 120 VU for 10 minutes (no ramp — pure peak percentiles)
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
