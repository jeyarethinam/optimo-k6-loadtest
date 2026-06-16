export const loadProfile = {
  smoke: {
    vus: 1,
    iterations: 1
  },

  // Legacy short peak profile.
  peak: {
    stages: [
      { duration: "2m", target: 20 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 20 }
    ]
  },

  // Production-style peak test:
  // - ramp up to 100 VUs
  // - hold 100 VUs for sustained peak window
  // - ramp down
  peak100_sustained: {
    stages: [
      { duration: "5m", target: 20 },
      { duration: "5m", target: 60 },
      { duration: "5m", target: 100 },
      { duration: "25m", target: 100 },
      { duration: "5m", target: 60 },
      { duration: "5m", target: 20 },
      { duration: "5m", target: 0 }
    ]
  },

  // 10-minute client-facing peak sample:
  // - 2m ramp up to 100 VUs
  // - 6m steady at 100 VUs
  // - 2m ramp down
  peak100_10m: {
    stages: [
      { duration: "2m", target: 100 },
      { duration: "6m", target: 100 },
      { duration: "2m", target: 0 }
    ]
  },

  // Pure peak window only (no ramp mix in latency percentiles).
  peak100_constant_10m: {
    vus: 100,
    duration: "10m"
  },

  // 10-minute Peak profile (matches typical UI: base 100, max 500):
  // 2m @ 100 → 2m ramp to 500 → 2m @ 500 → 2m ramp to 100 → 2m @ 100
  peak500_10m: {
    stages: [
      { duration: "2m", target: 100 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 100 }
    ]
  },

  // 500 VUs flat for 10 minutes (no ramp in latency percentiles)
  peak500_constant_10m: {
    vus: 500,
    duration: "10m"
  },

  // // 20 VUs for 5 minutes (constant load)
  // peak20: {
  //   vus: 20,
  //   duration: "5m"
  // },

  // Peak: 20 VUs, 10 min total, base 4 — 4 VUs 2m, ramp to 20 in 2m, hold 20 for 2m, ramp down to 4 in 2m, hold 4 for 2m
  peak20_10m: {
    stages: [
      { duration: "2m", target: 4 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 4 },
      { duration: "2m", target: 4 }
    ]
  },

  // Peak: 50 VUs, 5 min total (ramp + steady + ramp down)
  // 1m ramp up to 50 → 3m steady at 50 → 1m ramp down
  peak50_5m: {
    stages: [
      { duration: "1m", target: 50 },
      { duration: "3m", target: 50 },
      { duration: "1m", target: 0 }
    ]
  },

  // 200 VU peak – high load; expect many requests and some failures (timeouts, 5xx, rate limits)
  peak200: {
    stages: [
      { duration: "2m", target: 40 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 40 },
      { duration: "2m", target: 40 }
    ]
  },

  // 300 VU peak – same shape as peak200 (20% base, 2m stages, 10m total)
  peak300: {
    stages: [
      { duration: "2m", target: 60 },
      { duration: "2m", target: 300 },
      { duration: "2m", target: 300 },
      { duration: "2m", target: 60 },
      { duration: "2m", target: 60 }
    ]
  },

  // 400 VU peak – same shape as peak300 (20% base, 2m stages, 10m total)
  peak400: {
    stages: [
      { duration: "2m", target: 80 },
      { duration: "2m", target: 400 },
      { duration: "2m", target: 400 },
      { duration: "2m", target: 80 },
      { duration: "2m", target: 80 }
    ]
  }
};
