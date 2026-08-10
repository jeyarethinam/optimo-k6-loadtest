/**
 * ECOM Peak 500 VU / 10 min (base 100) — matches Peak UI:
 * 100 VUs 2m → ramp to 500 over 2m → hold 500 for 2m → down to 100 over 2m → hold 100 for 2m
 * Run: npm run peak500
 */
module.exports = {
  name: "peak500_10m",
  stages: [
    { duration: "2m", target: 100 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 500 },
    { duration: "2m", target: 100 },
    { duration: "2m", target: 100 },
  ],
};
