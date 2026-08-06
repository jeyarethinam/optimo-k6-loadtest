/**
 * WCC k6 runner: spawns `k6 run wcc-script.js` (not Postman). Artifacts under ./wcc/
 * (report.html, summary.json, metrics.json, k6-run.log, failed-requests.*).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("../shared/load-env.js");

const WCC_DIR = __dirname;
const REPO_ROOT = path.join(WCC_DIR, "..");
loadProjectEnv(REPO_ROOT, WCC_DIR);

const hasWccLogin =
  (process.env.WCC_LOGIN_USER && process.env.WCC_LOGIN_PASSWORD) ||
  (process.env.WCC_LOAD_LOGIN_USER && process.env.WCC_LOAD_LOGIN_PASSWORD);
if (!hasWccLogin) {
  process.stderr.write(
    "Missing WCC login env (need WCC_LOGIN_USER + WCC_LOGIN_PASSWORD, or WCC_LOAD_LOGIN_*).\n" +
      "Copy .env.example to .env and fill in WCC credentials, then retry.\n"
  );
  process.exit(1);
}

const LOG_FILE = path.join(WCC_DIR, "k6-run.log");
const RUN_SEQ_FILE = path.join(WCC_DIR, ".wcc-run-seq.json");
const mode = process.argv[2] || process.env.TEST_MODE || "smoke";
const AUTO_SHIFT_STEP_DAYS = 14;

function getAutoRunShiftDays() {
  if (process.env.WCC_RUN_DATE_SHIFT_DAYS && String(process.env.WCC_RUN_DATE_SHIFT_DAYS).trim() !== "") {
    return String(process.env.WCC_RUN_DATE_SHIFT_DAYS).trim();
  }
  let nextShift = 0;
  try {
    if (fs.existsSync(RUN_SEQ_FILE)) {
      const raw = fs.readFileSync(RUN_SEQ_FILE, "utf8");
      const j = JSON.parse(raw);
      const n = Number(j && j.nextShiftDays);
      if (Number.isFinite(n) && n >= 0) nextShift = Math.floor(n);
    }
  } catch (_) {}
  try {
    fs.writeFileSync(
      RUN_SEQ_FILE,
      JSON.stringify({ nextShiftDays: nextShift + 1, updatedAt: new Date().toISOString() }, null, 2)
    );
  } catch (_) {}
  return String(nextShift * AUTO_SHIFT_STEP_DAYS);
}

const autoShiftDays = getAutoRunShiftDays();
const flowMode = process.env.WCC_FLOW && String(process.env.WCC_FLOW).trim() !== ""
  ? String(process.env.WCC_FLOW).trim()
  : "both";

const k6Args = [
  "run",
  "--out",
  "json=metrics.json",
  "wcc-script.js",
  "-e",
  "TEST_MODE=" + mode,
  "-e",
  "WCC_FLOW=" + flowMode,
  "-e",
  "WCC_RUN_DATE_SHIFT_DAYS=" + autoShiftDays,
];

function teeAndRun() {
  const logStream = fs.createWriteStream(LOG_FILE, { flags: "w" });
  const child = spawn("k6", k6Args, {
    stdio: ["inherit", "pipe", "pipe"],
    cwd: WCC_DIR,
    shell: true,
  });

  function forward(data, out) {
    const s = data.toString();
    out.write(s);
    logStream.write(s);
  }

  child.stdout.on("data", (d) => forward(d, process.stdout));
  child.stderr.on("data", (d) => forward(d, process.stderr));

  child.on("close", (code) => {
    logStream.end(() => {
      let postStatus = 0;
      postStatus = Math.max(postStatus, runAddGraphs());
      postStatus = Math.max(postStatus, runExtractFailures());
      postStatus = Math.max(postStatus, runExtractErrorBookings());
      process.exit(Math.max(code || 0, postStatus));
    });
  });
}

function runAddGraphs() {
  const { spawnSync } = require("child_process");
  const r = spawnSync("node", [path.join(REPO_ROOT, "shared", "add-graphs.js"), WCC_DIR], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return r.status || 0;
}

function runExtractFailures() {
  const { spawnSync } = require("child_process");
  const r = spawnSync("node", [path.join(REPO_ROOT, "extract-failures.js"), LOG_FILE], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return r.status || 0;
}

function runExtractErrorBookings() {
  const { spawnSync } = require("child_process");
  const r = spawnSync("node", [path.join(REPO_ROOT, "extract-error-bookings.js"), LOG_FILE], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return r.status || 0;
}

teeAndRun();
