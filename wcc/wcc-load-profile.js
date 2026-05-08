/**
 * WCC-only load shapes (LA28 `load-profile.js` is unchanged).
 *
 * For non-smoke modes, `wcc-script.js` assigns ~80% of VUs to the simple day-package path and ~20% to the
 * complex recurring path when WCC_FLOW is `both` (default). Use WCC_FLOW=simple|complex to force 100%.
 */

export const wccLoadProfile = {
  smoke: {
    vus: 1,
    iterations: 1,
    // Ensure single smoke iteration can finish full simple + complex chains on slower UAT.
    maxDuration: "30m",
  },

  /**
   * 10 minutes total (performance-test “Peak” shape): base 10 VUs → ramp to 50 → hold 50 → ramp down to 10 → hold 10.
   * Each segment is 2 minutes. ~80% simple / ~20% complex when `WCC_FLOW=both` (see `wcc-script.js`).
   */
  peak50_wave_10m: {
    stages: [
      { duration: "2m", target: 10 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 10 },
      { duration: "2m", target: 10 },
    ],
  },

  /** @deprecated Prefer `peak50_wave_10m` for the 10m peak wave; kept for older scripts. */
  peak50_10m: {
    stages: [
      { duration: "2m", target: 25 },
      { duration: "6m", target: 50 },
      { duration: "2m", target: 0 },
    ],
  },

  /** Flat 50 virtual users for 10 minutes (constant peak). */
  peak50_const_10m: {
    vus: 50,
    duration: "10m",
  },

  /**
   * Short sanity load (~75s): 2 → 10 → 2 VUs. At 10 VUs, (VU−1)%10 gives 8 simple + 2 complex.
   * Use: `node wcc/run-wcc-load-test.js load_sanity` — verifies ramp + mixed flow + report pipeline without a 10m run.
   */
  load_sanity: {
    stages: [
      { duration: "15s", target: 2 },
      { duration: "15s", target: 10 },
      { duration: "30s", target: 10 },
      { duration: "15s", target: 2 },
    ],
  },
};
