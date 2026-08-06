/**
 * HRP k6 runner: artifacts under ./HRP/
 * - report.html / summary.json = latest run (working copies)
 * - report_YYYYMMDD_HHMMSS_<mode>.html = dated archive (kept each run)
 */)
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("../shared/load-env.js");

const HRP_DIR = __dirname;
const REPO_ROOT = path.join(HRP_DIR, "..");
loadProjectEnv(REPO_ROOT, HRP_DIR);

const baseUrl = process.env.HRP_BASE_URL || process.env.BASE_URL;
const username = process.env.HRP_USERNAME || process.env.USERNAME;
const password = process.env.HRP_PASSWORD || process.env.PASSWORD;
const missing = [];
if (!baseUrl || !String(baseUrl).trim()) missing.push("HRP_BASE_URL|BASE_URL");
if (!username || !String(username).trim()) missing.push("HRP_USERNAME|USERNAME");
if (!password || !String(password).trim()) missing.push("HRP_PASSWORD|PASSWORD");
if (missing.length) {
  process.stderr.write(
    `Missing required env: ${missing.join(", ")}\n` +
      `Copy .env.example to .env and fill in HRP (or shared) credentials, then retry.\n`
  );
  process.exit(1);
}

const LOG_FILE = path.join(HRP_DIR, "k6-run.log");
const mode = process.argv[2] || process.env.TEST_MODE || "smoke";

const k6Args = [
  "run",
  "--out",
  "json=metrics.json",
  "script.js",
  "-e",
  "TEST_MODE=" + mode,
];

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
    const p = String(process.env.K6_PATH).trim();
    return { command: p, args: k6Args, cwd: HRP_DIR };
  }
  if (commandExists("k6")) {
    return { command: "k6", args: k6Args, cwd: HRP_DIR };
  }
  const candidates = [
    path.join(REPO_ROOT, "bin", process.platform === "win32" ? "k6.exe" : "k6"),
    path.join(REPO_ROOT, "tools", process.platform === "win32" ? "k6.exe" : "k6"),
    path.join(HRP_DIR, "bin", process.platform === "win32" ? "k6.exe" : "k6"),
    ...(process.platform === "win32"
      ? [path.join(process.env.ProgramFiles || "C:\\Program Files", "k6", "k6.exe")]
      : []),
  ];
  for (const c of candidates) {
    if (fileExists(c)) return { command: c, args: k6Args, cwd: HRP_DIR };
  }
  if (commandExists("docker")) {
    return {
      command: "docker",
      args: ["run", "--rm", "-i", "-v", `${HRP_DIR}:/src`, "-w", "/src", "grafana/k6", ...k6Args],
      cwd: REPO_ROOT,
    };
  }
  return { command: "k6", args: k6Args, cwd: HRP_DIR, missing: true };
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
      // Archive final report after charts + failure injection (do not overwrite prior dated reports)
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
  const reportPath = path.join(HRP_DIR, "report.html");
  if (!fs.existsSync(reportPath)) {
    console.warn("No HRP/report.html to archive.");
    return 0;
  }
  const stamp = formatRunStamp();
  const modeSlug = String(mode || "run")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "run";
  const reportName = `report_${stamp}_${modeSlug}.html`;
  const reportOut = path.join(HRP_DIR, reportName);
  fs.copyFileSync(reportPath, reportOut);

  const summaryPath = path.join(HRP_DIR, "summary.json");
  if (fs.existsSync(summaryPath)) {
    fs.copyFileSync(summaryPath, path.join(HRP_DIR, `summary_${stamp}_${modeSlug}.json`));
  }

  fs.writeFileSync(path.join(HRP_DIR, ".hrp-last-report"), reportName + "\n", "utf8");
  console.log(`Dated report saved: HRP/${reportName}`);
  console.log(`(Latest working copy remains HRP/report.html)`);
  return 0;
}

function runAddGraphs() {
  const r = spawnSync("node", [path.join(REPO_ROOT, "shared", "add-graphs.js"), HRP_DIR, mode], {
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
  const r = spawnSync("node", [path.join(HRP_DIR, "inject-failures-into-report.js")], {
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
