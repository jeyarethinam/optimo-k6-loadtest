/**
 * ECOM k6 runner: artifacts stay under ./ECOM/ (report.html, summary.json, metrics.json, k6-run.log, failed-requests.*).
 */
const { spawn } = require("child_process");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("../shared/load-env.js");

const LA_DIR = __dirname;
const REPO_ROOT = path.join(LA_DIR, "..");
loadProjectEnv(REPO_ROOT, LA_DIR);

const missingEcom = ["BASE_URL", "USERNAME", "PASSWORD"].filter(
  (k) => !process.env[k] || !String(process.env[k]).trim()
);
if (missingEcom.length) {
  process.stderr.write(
    `Missing required env: ${missingEcom.join(", ")}\n` +
      `Copy .env.example to .env and fill in ECOM credentials, then retry.\n`
  );
  process.exit(1);
}

const LOG_FILE = path.join(LA_DIR, "k6-run.log");
const mode = process.argv[2] || process.env.TEST_MODE || "smoke";

function pushEnv(args, key, value) {
  if (value === undefined || value === null) return;
  const s = String(value);
  if (!s.trim()) return;
  args.push("-e", `${key}=${s}`);
}

const k6Args = [
  "run",
  "--out",
  "json=metrics.json",
  "script.js",
  "-e",
  "TEST_MODE=" + mode,
];
pushEnv(k6Args, "BASE_URL", process.env.BASE_URL);
pushEnv(k6Args, "USERNAME", process.env.USERNAME);
pushEnv(k6Args, "PASSWORD", process.env.PASSWORD);
pushEnv(k6Args, "ENV_NAME", process.env.ENV_NAME || process.env.ENV);
[
  "PACKAGE_IDS",
  "ECOM_PACKAGE_ID",
  "ECOM_PACKAGE_START",
  "ECOM_PACKAGE_END",
  "ECOM_PRICE_CONCESSION_ID",
  "ECOM_SALES_CHANNEL_ID",
  "CONTACT_ID",
  "CONTACT_EMAIL",
].forEach((k) => pushEnv(k6Args, k, process.env[k]));

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
  // 1) Explicit override
  if (process.env.K6_PATH && String(process.env.K6_PATH).trim()) {
    const p = String(process.env.K6_PATH).trim();
    if (fileExists(p)) return { command: p, args: k6Args, cwd: LA_DIR };
    // If set but invalid, still try to run it (so the error is explicit).
    return { command: p, args: k6Args, cwd: LA_DIR };
  }

  // 2) k6 on PATH
  if (commandExists("k6")) {
    return { command: "k6", args: k6Args, cwd: LA_DIR };
  }

  // 3) common local binary locations inside repo
  const candidates = [
    path.join(REPO_ROOT, "bin", process.platform === "win32" ? "k6.exe" : "k6"),
    path.join(REPO_ROOT, "tools", process.platform === "win32" ? "k6.exe" : "k6"),
    path.join(LA_DIR, "bin", process.platform === "win32" ? "k6.exe" : "k6"),
    ...(process.platform === "win32" ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "k6", "k6.exe")] : []),
  ];
  for (const c of candidates) {
    if (fileExists(c)) return { command: c, args: k6Args, cwd: LA_DIR };
  }

  // 4) Docker fallback (grafana/k6)
  if (commandExists("docker")) {
    // Mount LA_DIR to /src so k6 writes artifacts back (metrics.json etc.)
    // NOTE: On Windows, Docker Desktop handles drive mounts for paths like D:\...
    const dockerArgs = [
      "run",
      "--rm",
      "-i",
      "-v",
      `${LA_DIR}:/src`,
      "-w",
      "/src",
      "grafana/k6",
      ...k6Args,
    ];
    return { command: "docker", args: dockerArgs, cwd: REPO_ROOT };
  }

  return { command: "k6", args: k6Args, cwd: LA_DIR, missing: true };
}

function teeAndRun() {
  const logStream = fs.createWriteStream(LOG_FILE, { flags: "w" });
  const inv = resolveK6Invocation();
  if (inv.missing) {
    const msg =
      "k6 was not found. Install k6 (preferred) or Docker, or set K6_PATH to k6.exe.\n" +
      "Windows (winget): winget install k6 --source winget\n" +
      "Chocolatey: choco install k6\n" +
      "Docs: https://grafana.com/docs/k6/latest/set-up/install-k6/\n";
    process.stderr.write(msg);
    logStream.end(() => process.exit(1));
    return;
  }

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
      // Archive final report after charts + failure injection (new file per run)
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
  const reportPath = path.join(LA_DIR, "report.html");
  if (!fs.existsSync(reportPath)) {
    console.warn("No ECOM/report.html to archive.");
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
  fs.copyFileSync(reportPath, path.join(LA_DIR, reportName));

  const summaryPath = path.join(LA_DIR, "summary.json");
  if (fs.existsSync(summaryPath)) {
    fs.copyFileSync(summaryPath, path.join(LA_DIR, `summary_${stamp}_${modeSlug}.json`));
  }

  fs.writeFileSync(path.join(LA_DIR, ".ecom-last-report"), reportName + "\n", "utf8");
  console.log(`Dated report saved: ECOM/${reportName}`);
  console.log(`(Latest working copy remains ECOM/report.html)`);
  return 0;
}

function runAddGraphs() {
  const r = spawnSync("node", [path.join(REPO_ROOT, "shared", "add-graphs.js"), LA_DIR, mode], {
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
  const r = spawnSync("node", [path.join(LA_DIR, "inject-failures-into-report.js")], {
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
