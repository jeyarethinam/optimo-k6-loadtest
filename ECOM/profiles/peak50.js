/**
 * ECOM Peak 50 VU / 10 min (base 10) — matches Peak UI:
 * 10 VUs 2m → ramp to 50 over 2m → hold 50 for 2m → down to 10 over 2m → hold 10 for 2m
 * Run: npm run peak50
 */
module.exports = {
  name: "peak50",
  stages: [
    { duration: "2m", target: 10 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 50 },
    { duration: "2m", target: 10 },
    { duration: "2m", target: 10 },
  ],
};
