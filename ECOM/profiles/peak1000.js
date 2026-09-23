/**
 * ECOM Peak 1000 VU / 10 min (base 200) — matches Peak UI:
 * 200 VUs 2m → ramp to 1000 over 2m → hold 1000 for 2m → down to 200 over 2m → hold 200 for 2m
 * Run: npm run peak1000
 */
module.exports = {
  name: "peak1000",
  stages: [
    { duration: "2m", target: 200 },
    { duration: "2m", target: 1000 },
    { duration: "2m", target: 1000 },
    { duration: "2m", target: 200 },
    { duration: "2m", target: 200 },
  ],
};
