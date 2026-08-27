/**
 * LA28 k6 executor options keyed by TEST_MODE.
 * Run: `npm run smoke` or `node LA28/run-load-test.js <profile>`.
 *
 * Keep entries as k6-valid options only (vus, iterations, duration, stages, maxDuration).
 * Human-readable labels live in `profileInfo`.
 */

export const loadProfile = {
  /**
   * Smoke — functional sanity of the full booking flow (login → client → booking → payment → email).
   * 1 VU, 1 iteration. Not a load test. Typical runtime ~2–4 minutes.
   * `npm run smoke`
   */
  smoke: {
    vus: 1,
    iterations: 1,
    maxDuration: "15m",
  },

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
      { duration: "5m", target: 0 },
    ],
  },

  // 10-minute client-facing peak sample:
  // - 2m ramp up to 100 VUs
  // - 6m steady at 100 VUs
  // - 2m ramp down
  peak100_10m: {
    stages: [
      { duration: "2m", target: 100 },
      { duration: "6m", target: 100 },
      { duration: "2m", target: 0 },
    ],
  },

  // Pure peak window only (no ramp mix in latency percentiles).
  peak100_constant_10m: {
    vus: 100,
    duration: "10m",
  },

  // 10-minute Peak profile (matches typical UI: base 100, max 500):
  // 2m @ 100 → 2m ramp to 500 → 2m @ 500 → 2m ramp to 100 → 2m @ 100
  peak500_10m: {
    stages: [
      { duration: "2m", target: 100 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 100 },
    ],
  },

  // 500 VUs flat for 10 minutes (no ramp in latency percentiles)
  peak500_constant_10m: {
    vus: 500,
    duration: "10m",
  },

  // Peak: 20 VUs, 10 min total, base 4 — 4 VUs 2m, ramp to 20 in 2m, hold 20 for 2m, ramp down to 4 in 2m, hold 4 for 2m
  peak20_10m: {
    stages: [
      { duration: "2m", target: 4 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 4 },
      { duration: "2m", target: 4 },
    ],
  },

  // 20 VUs flat — `npm run peak20`
  peak20: {
    vus: 20,
    duration: "5m",
  },

  // 200 VU peak – high load; expect many requests and some failures (timeouts, 5xx, rate limits)
  peak200: {
    stages: [
      { duration: "2m", target: 40 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 40 },
      { duration: "2m", target: 40 },
    ],
  },
};

/** Display names for HTML reports and filenames (not passed to k6 options). */
export const profileInfo = {
  smoke: {
    label: "Smoke",
    summary: "Functional sanity of the full booking flow — not a load test",
  },
  peak: {
    label: "Peak (legacy)",
    summary: "Short 10-minute peak wave (20 → 100 → 20 VUs)",
  },
  peak100_sustained: {
    label: "Peak 100 sustained",
    summary: "Ramp to 100 VUs and hold about 25 minutes",
  },
  peak100_10m: {
    label: "Peak 100 (10m)",
    summary: "2m ramp to 100, 6m hold, 2m ramp down",
  },
  peak100_constant_10m: {
    label: "Peak 100 constant (10m)",
    summary: "100 VUs flat for 10 minutes",
  },
  peak500_10m: {
    label: "Peak 500 (10m)",
    summary: "10-minute wave: 100 → 500 → 100 VUs",
  },
  peak500_constant_10m: {
    label: "Peak 500 constant (10m)",
    summary: "500 VUs flat for 10 minutes",
  },
  peak20_10m: {
    label: "Peak 20 (10m)",
    summary: "10-minute wave: 4 → 20 → 4 VUs",
  },
  peak20: {
    label: "Peak 20",
    summary: "20 VUs constant for 5 minutes",
  },
  peak200: {
    label: "Peak 200",
    summary: "10-minute wave: 40 → 200 → 40 VUs",
  },
};

export function describeLoadShape(opts) {
  if (!opts) return "";
  if (Array.isArray(opts.stages) && opts.stages.length) {
    return opts.stages.map((s) => `${s.duration} @ ${s.target} VU`).join(" → ");
  }
  const vus = opts.vus ?? 1;
  if (opts.iterations != null) {
    const n = opts.iterations;
    return `${vus} VU × ${n} iteration${n === 1 ? "" : "s"}`;
  }
  if (opts.duration) {
    return `${vus} VU for ${opts.duration}`;
  }
  return "";
}

export function resolveProfile(testMode) {
  const requested = String(testMode || "smoke").trim() || "smoke";
  const opts = loadProfile[requested];
  if (!opts) {
    const known = Object.keys(loadProfile).join(", ");
    throw new Error(`Unknown TEST_MODE "${requested}". Known profiles: ${known}`);
  }
  const meta = profileInfo[requested] || { label: requested, summary: "" };
  return {
    key: requested,
    label: meta.label,
    summary: meta.summary,
    shape: describeLoadShape(opts),
    options: opts,
  };
}
