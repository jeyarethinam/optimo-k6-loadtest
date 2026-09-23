/**
 * ECOM Peak 120 VU / 10 min (base 24) — same shape as Peak 100:
 * 24 VUs 2m → ramp to 120 over 2m → hold 120 for 2m → down to 24 over 2m → hold 24 for 2m
 * Run: npm run peak120
 */
module.exports = {
  name: "peak120",
  stages: [
    { duration: "2m", target: 24 },
    { duration: "2m", target: 120 },
    { duration: "2m", target: 120 },
    { duration: "2m", target: 24 },
    { duration: "2m", target: 24 },
  ],
};
