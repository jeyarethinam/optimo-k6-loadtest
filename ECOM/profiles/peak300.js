/**
 * ECOM Peak 300 VU / 10 min (base 60) — matches Peak UI:
 * 60 VUs 2m → ramp to 300 over 2m → hold 300 for 2m → down to 60 over 2m → hold 60 for 2m
 * Run: npm run peak300
 */
module.exports = {
  name: "peak300",
  stages: [
    { duration: "2m", target: 60 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 300 },
    { duration: "2m", target: 60 },
    { duration: "2m", target: 60 },
  ],
};
