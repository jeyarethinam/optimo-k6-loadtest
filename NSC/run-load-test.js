/**
 * NSC k6 runner: artifacts under ./NSC/
 * - report.html / summary.json = latest run
 * - report_YYYYMMDD_HHMMSS_<mode>.html = dated archive
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("../shared/load-env.js");

const NSC_DIR = __dirname;
const REPO_ROOT = path.join(NSC_DIR, "..");
loadProjectEnv(REPO_ROOT, NSC_DIR);

const origin =
  process.env.NSC_ORIGIN ||
  (process.env.NSC_BASE_URL || "").replace(/\/bookingportal\/api\/?$/i, "") ||
  "";
const email =
  process.env.NSC_TEST_EMAIL_1 || process.env.NSC_TEST_EMAIL || process.env.USERNAME || "";
const password = process.env.NSC_TEST_PASSWORD || process.env.PASSWORD || "";

const missing = [];
if (!origin || !String(origin).trim()) missing.push("NSC_ORIGIN|NSC_BASE_URL");
if (!email || !String(email).trim()) missing.push("NSC_TEST_EMAIL_1|NSC_TEST_EMAIL|USERNAME");
if (!password || !String(password).trim()) missing.push("NSC_TEST_PASSWORD|PASSWORD");
if (missing.length) {
  process.stderr.write(
    `Missing required env: ${missing.join(", ")}\n` +
      `Copy .env.example values into .env (or NSC/.env), then retry.\n` +
      `Example: NSC_ORIGIN=https://nsc-play-booking-portal.azurewebsites.net\n`
  );
  process.exit(1);
}

const LOG_FILE = path.join(NSC_DIR, "k6-run.log");
const mode = process.argv[2] || process.env.TEST_MODE || "smoke";

function pushEnv(args, key, value) {
  if (value === undefined || value === null) return;
  const s = String(value);
  if (!s.trim()) return;
  args.push("-e", `${key}=${s}`);
}

const k6Args = ["run", "--out", "json=metrics.json", "script.js", "-e", "TEST_MODE=" + mode];

pushEnv(k6Args, "NSC_ORIGIN", origin);
pushEnv(k6Args, "NSC_TEST_PASSWORD", password);
pushEnv(k6Args, "PASSWORD", password);
pushEnv(k6Args, "NSC_TEST_EMAIL_1", email);
pushEnv(k6Args, "NSC_TEST_EMAIL_2", process.env.NSC_TEST_EMAIL_2);
pushEnv(k6Args, "NSC_TEST_EMAIL_3", process.env.NSC_TEST_EMAIL_3);
pushEnv(k6Args, "NSC_TEST_EMAIL", process.env.NSC_TEST_EMAIL);
pushEnv(k6Args, "ENV_NAME", process.env.ENV_NAME || process.env.ENV || "NSC");
pushEnv(k6Args, "NSC_RUN_ID", process.env.NSC_RUN_ID);
pushEnv(k6Args, "NSC_ASSET_ID", process.env.NSC_ASSET_ID);
pushEnv(k6Args, "NSC_PACKAGE_ID", process.env.NSC_PACKAGE_ID);
pushEnv(k6Args, "NSC_ITEM_ID", process.env.NSC_ITEM_ID);
pushEnv(k6Args, "NSC_FROM_DATE", process.env.NSC_FROM_DATE);
pushEnv(k6Args, "NSC_TO_DATE", process.env.NSC_TO_DATE);
pushEnv(k6Args, "NSC_SCAN_DAYS", process.env.NSC_SCAN_DAYS);
pushEnv(k6Args, "NSC_ITERATIONS_PER_USER", process.env.NSC_ITERATIONS_PER_USER);
pushEnv(k6Args, "THINK_TIME_ENABLED", process.env.THINK_TIME_ENABLED);
pushEnv(k6Args, "THINK_TIME_MIN_S", process.env.THINK_TIME_MIN_S);
pushEnv(k6Args, "THINK_TIME_MAX_S", process.env.THINK_TIME_MAX_S);
pushEnv(k6Args, "ITERATION_DELAY_S", process.env.ITERATION_DELAY_S);
pushEnv(k6Args, "ENABLE_RETRIES", process.env.ENABLE_RETRIES);
pushEnv(k6Args, "K6_PATH", process.env.K6_PATH);

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(cmd) {
  const which = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(which, [cmd], { stdio: "ignore", shell: false });
  return r.status === 0;
}

function resolveK6Invocation() {
  if (process.env.K6_PATH && String(process.env.K6_PATH).trim()) {
    return { command: String(process.env.K6_PATH).trim(), args: k6Args, cwd: NSC_DIR };
  }
  if (commandExists("k6")) {
    return { command: "k6", args: k6Args, cwd: NSC_DIR };
  }
  const candidates = [
    path.join(REPO_ROOT, "bin", process.platform === "win32" ? "k6.exe" : "k6"),
    path.join(REPO_ROOT, "tools", process.platform === "win32" ? "k6.exe" : "k6"),
    path.join(NSC_DIR, "bin", process.platform === "win32" ? "k6.exe" : "k6"),
    ...(process.platform === "win32"
      ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "k6", "k6.exe")]
      : []),
  ];
  for (const c of candidates) {
    if (fileExists(c)) return { command: c, args: k6Args, cwd: NSC_DIR };
  }
  if (commandExists("docker")) {
    return {
      command: "docker",
      args: ["run", "--rm", "-i", "-v", `${NSC_DIR}:/src`, "-w", "/src", "grafana/k6", ...k6Args],
      cwd: REPO_ROOT,
    };
  }
  return { command: "k6", args: k6Args, cwd: NSC_DIR, missing: true };
}

function teeAndRun() {
  const logStream = fs.createWriteStream(LOG_FILE, { flags: "w" });
  const inv = resolveK6Invocation();
  if (inv.missing) {
    process.stderr.write(
      "k6 was not found. Install k6 or Docker, or set K6_PATH.\n" +
        "Docs: https://grafana.com/docs/k6/latest/set-up/install-k6/\n"
    );
    logStream.end(() => process.exit(1));
    return;
  }

  console.log(`NSC k6 mode=${mode} origin=${origin}`);
  const child = spawn(inv.command, inv.args, {
    stdio: ["inherit", "pipe", "pipe"],
    cwd: inv.cwd,
    shell: false,
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
      postStatus = Math.max(postStatus, runInjectFailuresIntoReport());
      postStatus = Math.max(postStatus, runExtractErrorBookings());
      postStatus = Math.max(postStatus, archiveTimestampedReport());
      process.exit(Math.max(code || 0, postStatus));
    });
  });

  child.on("error", (err) => {
    const s = `Failed to start ${inv.command}: ${err && err.message ? err.message : String(err)}\n`;
    process.stderr.write(s);
    logStream.write(s);
    logStream.end(() => process.exit(1));
  });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatRunStamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function archiveTimestampedReport() {
  const reportPath = path.join(NSC_DIR, "report.html");
  if (!fs.existsSync(reportPath)) {
    console.warn("No NSC/report.html to archive.");
    return 0;
  }
  const stamp = formatRunStamp();
  const modeSlug =
    String(mode || "run")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "run";
  const reportName = `report_${stamp}_${modeSlug}.html`;
  fs.copyFileSync(reportPath, path.join(NSC_DIR, reportName));

  const summaryPath = path.join(NSC_DIR, "summary.json");
  if (fs.existsSync(summaryPath)) {
    fs.copyFileSync(summaryPath, path.join(NSC_DIR, `summary_${stamp}_${modeSlug}.json`));
  }

  fs.writeFileSync(path.join(NSC_DIR, ".nsc-last-report"), reportName + "\n", "utf8");
  console.log(`Dated report saved: NSC/${reportName}`);
  console.log(`(Latest working copy remains NSC/report.html)`);
  return 0;
}

function runAddGraphs() {
  const r = spawnSync("node", [path.join(REPO_ROOT, "shared", "add-graphs.js"), NSC_DIR, mode], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, TEST_MODE: mode, SKIP_TIMESTAMPED_REPORT_COPY: "1" },
  });
  return r.status || 0;
}

function runExtractFailures() {
  const r = spawnSync("node", [path.join(REPO_ROOT, "extract-failures.js"), LOG_FILE], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return r.status || 0;
}

function runInjectFailuresIntoReport() {
  const r = spawnSync("node", [path.join(NSC_DIR, "inject-failures-into-report.js")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return r.status || 0;
}

function runExtractErrorBookings() {
  const r = spawnSync("node", [path.join(REPO_ROOT, "extract-error-bookings.js"), LOG_FILE], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  return r.status || 0;
}

teeAndRun();
