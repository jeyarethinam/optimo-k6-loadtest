/**
 * HRP (Hospitality Request Portal) k6 config.
 * Override via env — same pattern as LA28 `data.js` / WCC `wcc-data.js`.
 */

function envStr(name, fallback = "") {
  const v = __ENV[name];
  return v !== undefined && String(v).trim() !== "" ? String(v).trim() : fallback;
}

function envNum(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || String(v).trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Prefer HRP_* then fall back to shared LA28 vars. */
export const BASE_URL = envStr("HRP_BASE_URL", envStr("BASE_URL", "")).replace(/\/+$/, "");

export const LOGIN_PAYLOAD = {
  username: envStr("HRP_USERNAME", envStr("USERNAME", "")),
  password: envStr("HRP_PASSWORD", envStr("PASSWORD", "")),
};

export const BOOKING_INCLUDE =
  "client,bookingStatus,BookingUserDefinedFields,bookingPackages,package,contact,BookingPackageNotes,BookingItems,Item";

export const LIST_INCLUDE = "client,bookingStatus,BookingUserDefinedFields";

/** Default: 50 public package IDs supplied for HRP load (override with HRP_PACKAGE_IDS=comma-separated). */
export const DEFAULT_PACKAGE_IDS = [
  7663, 7662, 7661, 7660, 7659, 7658, 7657, 7656, 7655, 7654,
  7653, 7652, 7651, 7650, 7649, 7648, 7647, 7646, 7645, 7644,
  7643, 7642, 7641, 7640, 7639, 7638, 7637, 7636, 7635, 7634,
  7633, 7632, 7631, 7630, 7629, 7628, 7627, 7626, 7625, 7624,
  7623, 7622, 7621, 7620, 7619, 7618, 7617, 7616, 7615, 7614,
];

export function resolvePackageIds() {
  const raw = envStr("HRP_PACKAGE_IDS", "");
  if (raw) {
    const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
    if (ids.length) return ids;
  }
  return DEFAULT_PACKAGE_IDS.map(String);
}

export const HRP_CONTACT_ID = envStr("HRP_CONTACT_ID", "7321");
export const HRP_CLIENT_REF = envStr("HRP_CLIENT_REF", "CO00007168");
export const HRP_EVENT_MANAGER_ID = envStr("HRP_EVENT_MANAGER_ID", "2");
export const HRP_PAYMENT_TERM_ID = envStr("HRP_PAYMENT_TERM_ID", "9");
export const HRP_BOOKING_SOURCE_ID = envNum("HRP_BOOKING_SOURCE_ID", 6);
export const HRP_SALES_CHANNEL_ID = envNum("HRP_SALES_CHANNEL_ID", 6);
export const HRP_STATUS_DRAFT = envStr("HRP_STATUS_DRAFT", "53");
export const HRP_STATUS_SUBMITTED = envStr("HRP_STATUS_SUBMITTED", "76");
export const HRP_UDF_REQUEST_ID = envStr("HRP_UDF_REQUEST_ID", "53");
export const HRP_UDF_PACKAGE_TYPE_ID = envStr("HRP_UDF_PACKAGE_TYPE_ID", "48");
export const HRP_UDF_REQUEST_VALUE = envStr("HRP_UDF_REQUEST_VALUE", "request");
export const HRP_UDF_PACKAGE_TYPE_VALUE = envStr("HRP_UDF_PACKAGE_TYPE_VALUE", "Signature Package");
export const HRP_EVENT_NAME_PREFIX = envStr("HRP_EVENT_NAME_PREFIX", "LT-OL-HRP-K6");
export const HRP_EVENT_FROM = envStr("HRP_EVENT_FROM", "2028-07-14");
export const HRP_EVENT_TO = envStr("HRP_EVENT_TO", "2028-07-30");
export const HRP_CANCEL_REASON_ID = envStr("HRP_CANCEL_REASON_ID", "2");
export const HRP_LIST_STATUS_IDS = envStr(
  "HRP_LIST_STATUS_IDS",
  "53,76,83,77,74,75,72,96,73,71,95,69,94,99,60"
);

/** Stagger start times across the event window (MD sample pattern). */
const START_TIME_SLOTS = [
  "10:00:00", "11:15:00", "12:00:00", "13:00:00", "14:00:00",
  "15:00:00", "16:00:00", "17:00:00", "18:00:00", "19:00:00",
  "20:00:00",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseYmd(ymd) {
  const parts = String(ymd).split("-").map((x) => parseInt(x, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (![y, m, d].every((n) => Number.isFinite(n))) return new Date(2028, 6, 14);
  return new Date(y, m - 1, d);
}

function formatYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function daysBetween(from, to) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

/**
 * Dynamic package startDate for package index + VU/iteration slot.
 * Spreads load across the event window so concurrent VUs do not all hit the same day/time.
 */
export function resolvePackageStartDate(packageIndex, slotIndex = 0) {
  const span = daysBetween(HRP_EVENT_FROM, HRP_EVENT_TO);
  const dayOffset = (Number(packageIndex) + Number(slotIndex)) % (span + 1);
  const base = parseYmd(HRP_EVENT_FROM);
  base.setDate(base.getDate() + dayOffset);
  const time = START_TIME_SLOTS[(Number(packageIndex) + Number(slotIndex)) % START_TIME_SLOTS.length];
  return `${formatYmd(base)}T${time}`;
}

export function todayYmd() {
  const d = new Date();
  return formatYmd(d);
}

export function uniqueEventName(vu, iter) {
  const stamp = Date.now().toString(36);
  return `${HRP_EVENT_NAME_PREFIX}-vu${vu}-i${iter}-${stamp}`;
}
