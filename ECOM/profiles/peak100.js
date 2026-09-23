/**
 * ECOM Peak 100 VU / 10 min (base 20) — matches Peak UI:
 * 20 VUs 2m → ramp to 100 over 2m → hold 100 for 2m → down to 20 over 2m → hold 20 for 2m
 * Run: npm run peak100
 */
module.exports = {
  name: "peak100",
  stages: [
    { duration: "2m", target: 20 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 20 },
    { duration: "2m", target: 20 },
  ],
};
