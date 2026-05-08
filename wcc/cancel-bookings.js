#!/usr/bin/env node
/**
 * WCC UAT — cancel bookings only (single endpoint: POST .../bookings/:id/cancel-booking).
 *
 * Usage:
 *   npm run cancel-bookings:wcc
 *
 * Auth (first match wins):
 *   WCC_TOKEN or WCC_CANCEL_TOKEN or LOCAL_WCC_TOKEN — use as REST `token` header
 *   Else logs in with POST .../users/login (same as k6): WCC_LOAD_LOGIN_USER/PASSWORD if both set,
 *   otherwise WCC_LOGIN_USER / WCC_LOGIN_PASSWORD.
 *
 * Optional env:
 *   WCC_BASE_URL     default https://wcc-uat.optimo.training/restapi
 *   WCC_BOOKING_IDS  comma-separated IDs (overrides built-in list)
 *   WCC_CANCEL_REASON_ID  default 2
 *   WCC_CANCEL_NOTE     default "Bulk cancel via cancel-bookings.js"
 *   WCC_CANCEL_DATE     default today (YYYY-MM-DD) in local timezone
 *   WCC_CANCEL_DELAY_MS  pause between calls (default 250)
 *   WCC_CANCEL_DRY_RUN   if "1" or "true", print URLs only
 *   WCC_CANCEL_STRICT    if "1" or "true", exit 1 when any cancel fails (default "0" = exit 0 if at least one succeeded)
 *
 * Requires Node 18+ (global fetch).
 */

const DEFAULT_BASE = "https://wcc-uat.optimo.training/restapi";

/** Same `include` as your browser curl (trimmed only if you change API). */
const CANCEL_INCLUDE =
  "Client,Salesperson,Bookingpackages,Contact,CommunicationMethods,Bookingstatus,invoiceAddress,deliveryAddress,cancellationPolicy,paymentTerm,deliveryMethod,BookingItems,referrerClient,referrerContact,BookingUserDefinedFields,address,BookingQuestionnaires,splitBookingItems,supplier,package,RecurrentBookingItems,RecurrenceOption,UserDefinedFields";

/** Default batch you provided (newest → oldest). Override with WCC_BOOKING_IDS. */
const DEFAULT_BOOKING_IDS = [
11601,
11600,
11599,
11598,
11597,
11596,
11595,
11594,
11593,
11592,
11591,
11590,
11589,
11588,
11587,
11586,
11585,
11584,
11583,
11582,
11581,
11580,
11579,
11578,
11577,
11576,
11575,
11574,
11573,
11572,
11571,
11570,
11569,
11568,
11567,
11566,
11565,
11564,
11563,
11562,
11561,
11560,
11559,
11558,
11557,
11556,
11555,
11554,
11553,
11552,
11551,
11550,
11549,
11548,
11547,
11546,
11545,
11544,
11542,
11541,
11540,
11539,
11538,
11537,
11536,
11535,
11534,
11533,
11532,
11531,
11530,
11529,
11528,
11527,
11526,
11525,
11524,
11523,
11522,
11521,
11520,
11519,
11518,
11517,
11516,
11515,
11514,
11513,
11512,
11511,
11510,
11509,
11508,
11507,
11506,
11505,
11504,
11503,
11502,
11501,
11500,
11499,
11498,
11497,
11496,
11495,
11494,
11493,
11492,
11491,
11490,
11489,
11488,
11487,
11486,
11485,
11484,
11483,
11482,
11481,
11480,
11479,
11478,
11477,
11476,
11475,
11474,
11473,
11472,
11471,
11470,
11469,
11468,
11467,
11466,
11465,
11464,
11463,
11462,
11461,
11460,
11459,
11458,
11457,
11456,
11455,
11454,
11453,
11452,
11451,
11450,
11449,
11448,
11447,
11446,
11445,
11444,
11443,
11442,
11441,
11440,
11439,
11437,
11436,
11435,
11434,
11433,
11432,
11431,
11430,
11429,
11428,
11427,
11426,
11425,
11424,
11423,
11422,
11421,
11420,
11419,
11418,
11417,
11416,
11415,
11414,
11413,
11412,
11411,
11410,
11409,
11408,
11407,
11406,
11405,
11404,
11403,
11402,
11401,
11400,
11399,
11398,
11397,
11396,
11395,
11394,
11393,
11392,
11391,
11390,
11389,
11388,
11387,
11386,
11385,
11384,
11383,
11382,
11381,
11380,
11379,
11378,
11377,
11376,
11375,
11374,
11373,
11372,
11371,
11370,
11369,
11368,
11367,
11366,
11365,
11364,
11363,
11362,
11361,
11360,
11359,
11358,
11357,
11356,
11355,
11354,
11353,
11352,
11351,
11350,
11349,
11348,
11347,
11346,
11345,
11344,
11343,
11342,
11341,
11340,
11339,
11338,
11337,
];

/**
 * REST API `token` header (same string as Postman / browser devtools). Leave empty and use WCC_TOKEN env for CI/shared machines.
 */
const LOCAL_WCC_TOKEN = "";

function envStr(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function parseIds() {
  const raw = envStr("WCC_BOOKING_IDS", "");
  if (raw) {
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }
  return [...DEFAULT_BOOKING_IDS];
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Match `wccLoginJsonBody` load path (non-smoke): load creds if set, else WCC_LOGIN_*. */
function buildLoginBody() {
  const loadU = process.env.WCC_LOAD_LOGIN_USER;
  const loadP = process.env.WCC_LOAD_LOGIN_PASSWORD;
  if (loadU && loadP) {
    return JSON.stringify({ username: loadU, password: loadP });
  }
  return JSON.stringify({
    username: envStr("WCC_LOGIN_USER", "optimo"),
    password: envStr("WCC_LOGIN_PASSWORD", ""),
  });
}

async function loginForToken(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v4.1/users/login?fields=token`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: buildLoginBody(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Login HTTP ${res.status}: ${text.length > 300 ? text.slice(0, 300) + "…" : text}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Login: response was not JSON");
  }
  const token = body.token || body.data?.token || body.meta?.token;
  if (!token) throw new Error("Login: token missing in response");
  return String(token);
}

function buildBody(bookingId) {
  const reasonId = envStr("WCC_CANCEL_REASON_ID", "2");
  const note = envStr("WCC_CANCEL_NOTE", "Bulk cancel via cancel-bookings.js");
  const cancelledDate = envStr("WCC_CANCEL_DATE", todayYmd());
  return {
    data: {
      type: "booking",
      id: String(bookingId),
      attributes: {
        CancellationReasonId: String(reasonId),
        cancellationFee: "0",
        Note: note,
        cancelledDate,
        cancelled: true,
      },
    },
  };
}

async function cancelOne(baseUrl, token, bookingId, dryRun) {
  const enc = encodeURIComponent(CANCEL_INCLUDE);
  const url = `${baseUrl.replace(/\/$/, "")}/api/V4.1/bookings/${bookingId}/cancel-booking?include=${enc}`;
  if (dryRun) {
    console.log(`[dry-run] ${url}`);
    return { ok: true, status: 0, bookingId, dryRun: true };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      token,
      language: "en",
    },
    body: JSON.stringify(buildBody(bookingId)),
  });

  const text = await res.text();
  const snippet = text.length > 500 ? text.slice(0, 500) + "…" : text;
  if (!res.ok) {
    // stdout only so summary line order matches execution (stderr can flush late on Windows)
    console.log(`FAIL booking ${bookingId} HTTP ${res.status} ${res.statusText}`);
    console.log(snippet);
    return { ok: false, status: res.status, bookingId, body: text, snippet };
  }
  console.log(`OK booking ${bookingId} HTTP ${res.status}`);
  return { ok: true, status: res.status, bookingId };
}

async function main() {
  const baseUrl = envStr("WCC_BASE_URL", DEFAULT_BASE);
  let token = envStr("WCC_TOKEN", envStr("WCC_CANCEL_TOKEN", String(LOCAL_WCC_TOKEN || "").trim()));
  const dryRun = /^1|true$/i.test(envStr("WCC_CANCEL_DRY_RUN", ""));
  const strict = /^1|true$/i.test(envStr("WCC_CANCEL_STRICT", "0"));
  const delayMs = Number(envStr("WCC_CANCEL_DELAY_MS", "250")) || 0;

  const ids = parseIds();
  if (!ids.length) {
    console.error("No booking IDs (set WCC_BOOKING_IDS or edit DEFAULT_BOOKING_IDS).");
    process.exit(1);
  }
  if (!token && !dryRun) {
    try {
      console.log("No WCC_TOKEN — logging in via POST .../users/login (WCC_LOGIN_* / WCC_LOAD_LOGIN_*).");
      token = await loginForToken(baseUrl);
    } catch (e) {
      console.error(e.message || e);
      console.error("Fix credentials or set WCC_TOKEN to the REST `token` header value.");
      process.exit(1);
    }
  }

  console.log(`Base: ${baseUrl}`);
  console.log(`Bookings to cancel: ${ids.length}${dryRun ? " (dry run)" : ""}`);

  const results = { ok: 0, fail: 0 };
  const failedIds = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      const r = await cancelOne(baseUrl, token, id, dryRun);
      if (r.ok) results.ok++;
      else {
        results.fail++;
        failedIds.push({ id, status: r.status });
      }
    } catch (e) {
      console.log(`ERROR booking ${id}: ${e.message || e}`);
      results.fail++;
      failedIds.push({ id, status: 0 });
    }
    if (i < ids.length - 1 && delayMs > 0) await sleep(delayMs);
  }

  console.log(`Done. Succeeded: ${results.ok}, failed: ${results.fail}`);
  if (failedIds.length) {
    console.log(`Failed IDs: ${failedIds.map((f) => f.id).join(", ")}`);
    if (failedIds.some((f) => f.status === 403)) {
      console.log("Note: HTTP 403 usually means this login cannot cancel that booking (owner / role / policy).");
    }
  }

  if (results.ok === 0 && results.fail > 0) process.exit(1);
  if (strict && results.fail > 0) process.exit(1);
  process.exit(0);
}

main();
