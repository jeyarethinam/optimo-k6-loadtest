/**
 * Private-event date pools for WCC k6: disjoint calendars for simple (1 day) vs complex (5-day blocks).
 *
 * Allocation model (no shared RAM between VUs in k6):
 *   rawSlot = (VU − 1) + WCC_ALLOC_VU_STRIDE × iteration + WCC_RUN_DATE_SHIFT_DAYS
 * with WCC_ALLOC_VU_STRIDE ≥ peak VU count so each (VU, iteration) maps to a unique slot before wrap.
 *
 * Optional skips: WCC_EXCLUDED_SIMPLE_SLOTS, WCC_EXCLUDED_SIMPLE_DATES, WCC_EXCLUDED_COMPLEX_BLOCKS
 * (see wcc-script.js header).
 */

function envStr(name, fallback) {
  const v = __ENV[name];
  return v !== undefined && v !== "" ? v : fallback;
}

const FIXED_SIMPLE_POOL_FIRST = "2026-05-01";
const FIXED_SIMPLE_POOL_LAST = "2035-12-30";
const FIXED_COMPLEX_POOL_FIRST = "2037-01-01";
const FIXED_COMPLEX_POOL_LAST = "2045-12-30";

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function parseYmdLocal(ymd) {
  const segs = String(ymd)
    .trim()
    .split("-")
    .map((x) => parseInt(x, 10));
  const y = Number.isFinite(segs[0]) ? segs[0] : 1970;
  const m = Number.isFinite(segs[1]) ? segs[1] : 1;
  const d = Number.isFinite(segs[2]) ? segs[2] : 1;
  return new Date(y, m - 1, d);
}

function ymdFromDate(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function calendarDaysInclusive(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

export function simplePoolBounds() {
  return {
    first: parseYmdLocal(FIXED_SIMPLE_POOL_FIRST),
    last: parseYmdLocal(FIXED_SIMPLE_POOL_LAST),
  };
}

export function complexPoolBounds() {
  return {
    first: parseYmdLocal(FIXED_COMPLEX_POOL_FIRST),
    last: parseYmdLocal(FIXED_COMPLEX_POOL_LAST),
  };
}

export function simplePoolDayCount() {
  const { first, last } = simplePoolBounds();
  const n = calendarDaysInclusive(first, last);
  return n > 0 ? n : 0;
}

/** Full 5-day blocks that fit starting at pool first day. */
export function complexFiveDayBlockCapacity() {
  const { first, last } = complexPoolBounds();
  const D = calendarDaysInclusive(first, last);
  return D >= 5 ? Math.floor(D / 5) : 0;
}

function isStrict() {
  const v = String(__ENV.WCC_DATE_ALLOC_STRICT || "").toLowerCase();
  return v === "1" || v === "true";
}

let excludedSimpleSlotsMemo = null;
function excludedSimpleSlotSet() {
  if (excludedSimpleSlotsMemo) return excludedSimpleSlotsMemo;
  const ex = new Set();
  const slots = envStr("WCC_EXCLUDED_SIMPLE_SLOTS", "");
  if (slots) {
    for (const p of slots.split(/[\s,]+/)) {
      if (!p) continue;
      const n = parseInt(p, 10);
      if (Number.isFinite(n) && n >= 0) ex.add(n);
    }
  }
  const dates = envStr("WCC_EXCLUDED_SIMPLE_DATES", "");
  if (dates) {
    const { first } = simplePoolBounds();
    const cap = simplePoolDayCount();
    for (const p of dates.split(/[\s,]+/)) {
      if (!p) continue;
      const dt = parseYmdLocal(p);
      const idx = Math.floor((dt.getTime() - first.getTime()) / 86400000);
      if (idx >= 0 && idx < cap) ex.add(idx);
    }
  }
  excludedSimpleSlotsMemo = ex;
  return ex;
}

let excludedComplexBlocksMemo = null;
function excludedComplexBlockSet() {
  if (excludedComplexBlocksMemo) return excludedComplexBlocksMemo;
  const ex = new Set();
  const raw = envStr("WCC_EXCLUDED_COMPLEX_BLOCKS", "");
  if (raw) {
    for (const p of raw.split(/[\s,]+/)) {
      if (!p) continue;
      const n = parseInt(p, 10);
      if (Number.isFinite(n) && n >= 0) ex.add(n);
    }
  }
  excludedComplexBlocksMemo = ex;
  return ex;
}

/**
 * @param {number} rawSlot - from (vu-1) + stride*iter (+ shift)
 * @returns {{ simpleDayStart: string, simpleDayEnd: string, slotIndex: number, poolDayCount: number }}
 */
export function allocateSimpleBookingDay(rawSlot) {
  const { first, last } = simplePoolBounds();
  const cap = simplePoolDayCount();
  if (cap <= 0) {
    throw new Error("WCC simple date pool is empty (check WCC_SIMPLE_POOL_FIRST / WCC_SIMPLE_POOL_LAST)");
  }

  let s = Math.max(0, Math.floor(Number(rawSlot) || 0));
  if (s >= cap) {
    if (isStrict()) {
      throw new Error(`WCC simple slot ${s} >= pool capacity ${cap} days; widen range or lower iterations / stride`);
    }
    const wrapped = s % cap;
    if (wrapped !== s) {
      console.warn(
        `[WCC] simple slot ${s} wrapped to ${wrapped} (pool ${cap} days). Collisions possible after wrap. Use WCC_DATE_ALLOC_STRICT=true to fail instead.`
      );
    }
    s = wrapped;
  }

  const ex = excludedSimpleSlotSet();
  let guard = 0;
  while (ex.has(s) && guard < cap + ex.size + 4) {
    s += 1;
    if (s >= cap) {
      if (isStrict()) {
        throw new Error("WCC simple: no free day after applying exclusions (strict)");
      }
      s = 0;
      console.warn("[WCC] simple: wrapped while skipping excluded slots");
    }
    guard += 1;
  }
  if (ex.has(s)) {
    throw new Error("WCC simple: exclusions cover the entire pool — free a date or shrink exclusions");
  }

  const day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  day.setDate(day.getDate() + s);
  if (day.getTime() > last.getTime()) {
    throw new Error("WCC simple: computed day past pool end (internal error)");
  }

  const ym = ymdFromDate(day);
  return {
    simpleDayStart: `${ym}T00:00:00`,
    simpleDayEnd: `${ym}T23:59:59`,
    slotIndex: s,
    poolDayCount: cap,
  };
}

/**
 * @param {number} rawBlockIndex - sequential block index (0 = first five days of pool)
 * @returns {{ complexStart: string, complexEnd: string, blockIndex: number, blockCapacity: number }}
 */
export function allocateComplexFiveDayBlock(rawBlockIndex) {
  const { first, last } = complexPoolBounds();
  const cap = complexFiveDayBlockCapacity();
  if (cap <= 0) {
    throw new Error("WCC complex pool cannot fit a 5-day block (check WCC_COMPLEX_POOL_* dates)");
  }

  let b = Math.max(0, Math.floor(Number(rawBlockIndex) || 0));
  if (b >= cap) {
    if (isStrict()) {
      throw new Error(`WCC complex block ${b} >= capacity ${cap} blocks; widen range or lower iterations / stride`);
    }
    const wrapped = b % cap;
    if (wrapped !== b) {
      console.warn(
        `[WCC] complex block ${b} wrapped to ${wrapped} (${cap} blocks). Collisions possible. Use WCC_DATE_ALLOC_STRICT=true to fail.`
      );
    }
    b = wrapped;
  }

  const ex = excludedComplexBlockSet();
  let guard = 0;
  while (ex.has(b) && guard < cap + ex.size + 4) {
    b += 1;
    if (b >= cap) {
      if (isStrict()) {
        throw new Error("WCC complex: no free block after exclusions (strict)");
      }
      b = 0;
      console.warn("[WCC] complex: wrapped while skipping excluded blocks");
    }
    guard += 1;
  }
  if (ex.has(b)) {
    throw new Error("WCC complex: exclusions cover all blocks");
  }

  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate());
  start.setDate(start.getDate() + b * 5);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  end.setDate(end.getDate() + 4);
  if (end.getTime() > last.getTime()) {
    throw new Error("WCC complex: block extends past pool end (internal error)");
  }

  return {
    complexStart: `${ymdFromDate(start)}T00:00:00`,
    complexEnd: `${ymdFromDate(end)}T23:59:59`,
    blockIndex: b,
    blockCapacity: cap,
  };
}
