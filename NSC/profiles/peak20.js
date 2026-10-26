/**
 * NSC Peak 20 VU / 5 min / base 5
 * 5 VUs 1m → 10 over 1m → 20 over 1m → down to 10 over 1m → down to 5 over 1m
 * Run: npm run peak20:nsc
 */
module.exports = {
  name: "peak20",
  description: "Peak 20 / 5m / base 5",
  stages: [
    { duration: "1m", target: 5 },
    { duration: "1m", target: 10 },
    { duration: "1m", target: 20 },
    { duration: "1m", target: 10 },
    { duration: "1m", target: 5 },
  ],
};
