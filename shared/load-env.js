/**
 * Load KEY=VALUE pairs from a .env file into process.env.
 * Values from the file override existing env (needed on Windows where USERNAME is always set).
 */
const fs = require("fs");
const path = require("path");

function stripQuotes(v) {
  const s = String(v).trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    process.env[key] = stripQuotes(trimmed.slice(eq + 1));
  }
  return true;
}

/**
 * Load repo-root `.env`, then optional suite file (e.g. `ECOM/.env` or `wcc/.env`).
 * @param {string} repoRoot
 * @param {string} [suiteDir]
 */
function loadProjectEnv(repoRoot, suiteDir) {
  const rootEnv = path.join(repoRoot, ".env");
  const loaded = [];
  if (loadEnvFile(rootEnv)) loaded.push(rootEnv);
  if (suiteDir) {
    const suiteEnv = path.join(suiteDir, ".env");
    if (suiteEnv !== rootEnv && loadEnvFile(suiteEnv)) loaded.push(suiteEnv);
  }
  return loaded;
}

module.exports = { loadEnvFile, loadProjectEnv };
