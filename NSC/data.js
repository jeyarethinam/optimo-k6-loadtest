/**
 * NSC Play booking portal k6 config. Env (__ENV / .env via runner) overrides defaults.
 */

function envStr(name, fallback = "") {
  const v = __ENV[name];
  return v !== undefined && String(v).trim() !== "" ? String(v).trim() : fallback;
}

function envNum(name, fallback) {
  const n = Number(envStr(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

/** Origin only (no /bookingportal/api). */
export const ORIGIN = envStr(
  "NSC_ORIGIN",
  envStr("NSC_BASE_URL", "https://nsc-play-booking-portal.azurewebsites.net").replace(
    /\/bookingportal\/api\/?$/i,
    ""
  )
).replace(/\/+$/, "");

export const API_BASE = ORIGIN + "/bookingportal/api";

export const ASSET_ID = envStr("NSC_ASSET_ID", "586");
export const PACKAGE_ID = envStr("NSC_PACKAGE_ID", "58");
export const PACKAGE_NAME_HINT = envStr("NSC_PACKAGE_NAME_HINT", "Ceremon");
export const ITEM_ID = envStr("NSC_ITEM_ID", "2156");

export const FROM_DATE = envStr("NSC_FROM_DATE", "2026-11-03");
export const TO_DATE = envStr("NSC_TO_DATE", "2026-11-10");
export const SCAN_DAYS = envNum("NSC_SCAN_DAYS", 7);

/** Shared password for dedicated UAT test accounts (prompted / .env — never commit). */
export const TEST_PASSWORD = envStr("NSC_TEST_PASSWORD", envStr("PASSWORD", ""));

/**
 * Up to N emails: NSC_TEST_EMAIL_1 .. NSC_TEST_EMAIL_N, or single NSC_TEST_EMAIL / USERNAME.
 */
export function getTestEmails() {
  const emails = [];
  for (let n = 1; n <= 20; n++) {
    const e = envStr(`NSC_TEST_EMAIL_${n}`, "");
    if (e) emails.push(e);
  }
  if (!emails.length) {
    const one = envStr("NSC_TEST_EMAIL", envStr("USERNAME", ""));
    if (one) emails.push(one);
  }
  return emails;
}

export function emailForVu(vu) {
  const emails = getTestEmails();
  if (!emails.length) return "";
  return emails[(Math.max(1, vu) - 1) % emails.length];
}

export const jsonHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: ORIGIN,
};
