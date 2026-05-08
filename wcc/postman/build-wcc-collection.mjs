/**
 * Builds WCC-Booking-dynamic.postman_collection.json from an exported "WCC Booking follow" collection.
 *
 * Usage:
 *   node wcc/postman/build-wcc-collection.mjs "C:/path/WCC Booking follow.postman_collection.json"
 *
 * Output: wcc/postman/WCC-Booking-dynamic.postman_collection.json (next to this script)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "WCC-Booking-dynamic.postman_collection.json");

const COLLECTION_PREREQUEST = `const t = pm.variables.get("token") || pm.environment.get("token");
if (t) {
  pm.request.headers.remove("Token");
  pm.request.headers.remove("token");
  pm.request.headers.add({ key: "Token", value: t });
  pm.request.headers.add({ key: "token", value: t });
}`;

function saveVar(key, value) {
  return `
const _isLoadRun = pm.environment.get("isLoadRun");
function saveVar(key, value) {
  if (value === undefined || value === null || value === "") return;
  const s = String(value);
  pm.variables.set(key, s);
  if (_isLoadRun !== "true") {
    pm.environment.set(key, s);
    console.log(key + ":", s);
  }
}
function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}`.trim();
}

const TEST_SCRIPTS = {
  "Create Empty Booking": `${saveVar("")}
if (pm.response.code >= 200 && pm.response.code < 300) {
  const json = safeJsonParse(pm.response.text());
  const id = json && json.data && json.data.id;
  saveVar("wcc_simple_booking_id", id);
  pm.test("Saved booking id", function () { pm.expect(id).to.be.ok; });
} else {
  pm.test("Create Empty Booking failed", function () { pm.expect.fail("status " + pm.response.code); });
}`,

  "Client Create": `${saveVar("")}
if (pm.response.code >= 200 && pm.response.code < 300) {
  const json = safeJsonParse(pm.response.text());
  const clientId = json && json.data && json.data.id;
  saveVar("wcc_simple_client_id", clientId);
  let contactId = "";
  const inc = (json && json.included) || [];
  for (let i = 0; i < inc.length; i++) {
    if (inc[i].type === "Contact" || inc[i].type === "contact") {
      contactId = inc[i].id;
      break;
    }
  }
  saveVar("wcc_simple_contact_id", contactId);
  pm.test("Saved client/contact", function () {
    pm.expect(clientId).to.be.ok;
    pm.expect(contactId).to.be.ok;
  });
} else {
  pm.test("Client Create failed", function () { pm.expect.fail("status " + pm.response.code); });
}`,

  "Add Package to booking": `${saveVar("")}
if (pm.response.code >= 200 && pm.response.code < 300) {
  const json = safeJsonParse(pm.response.text());
  let pkgId = "";
  const inc = (json && json.included) || [];
  for (let i = 0; i < inc.length; i++) {
    if (inc[i].type === "BookingPackage") {
      pkgId = inc[i].id;
      break;
    }
  }
  if (!pkgId && json && json.data && json.data.relationships && json.data.relationships.bookingPackages) {
    const d = json.data.relationships.bookingPackages.data;
    if (d && d[0]) pkgId = d[0].id;
  }
  saveVar("wcc_simple_booking_package_id", pkgId);
  pm.test("Saved booking package id", function () { pm.expect(pkgId).to.be.ok; });
} else {
  pm.test("Add Package failed", function () { pm.expect.fail("status " + pm.response.code); });
}`,

  "Create Daily Recurring -5 Days": `${saveVar("")}
if (pm.response.code >= 200 && pm.response.code < 300) {
  const json = safeJsonParse(pm.response.text());
  const id = json && json.data && json.data.id;
  saveVar("wcc_complex_booking_id", id);
  pm.test("Saved complex booking id", function () { pm.expect(id).to.be.ok; });
} else {
  pm.test("Create complex booking failed", function () { pm.expect.fail("status " + pm.response.code); });
}`,

};

function patchUrlRaw(raw, folderKind) {
  if (typeof raw !== "string") return raw;
  let s = raw.replace(/https:\/\/wcc-uat\.optimo\.training\/restapi/gi, "{{base_Generic}}");
  s = s.replace(/\{\{base_Generic\}\}\/\//g, "{{base_Generic}}/");
  if (folderKind === "simple") {
    s = s.replace(/\b10267\b/g, "{{wcc_simple_booking_id}}");
    s = s.replace(/\b10251\b/g, "{{wcc_simple_booking_id}}");
    s = s.replace(/\b14309\b/g, "{{wcc_simple_booking_package_id}}");
    s = s.replace(/BP10267/g, "BP{{wcc_simple_booking_id}}");
  }
  if (folderKind === "complex") {
    s = s.replace(/\b11275\b/g, "{{wcc_complex_booking_id}}");
  }
  return s;
}

function patchUrlPathArray(pathArr, folderKind) {
  if (!Array.isArray(pathArr)) return;
  for (let i = 0; i < pathArr.length; i++) {
    const p = pathArr[i];
    if (folderKind === "simple") {
      if (p === "10267" || p === "10251") pathArr[i] = "{{wcc_simple_booking_id}}";
      if (p === "14309") pathArr[i] = "{{wcc_simple_booking_package_id}}";
    }
    if (folderKind === "complex") {
      if (p === "11275") pathArr[i] = "{{wcc_complex_booking_id}}";
    }
  }
}

function patchHeaders(headers) {
  if (!Array.isArray(headers)) return;
  for (const h of headers) {
    const k = (h.key || "").toLowerCase();
    if (k === "cookie") {
      h.disabled = true;
      h.value = "";
      continue;
    }
    if (k === "token" || h.key === "Token") {
      h.value = "{{token}}";
    }
  }
}

function patchBodyRaw(raw, folderKind) {
  if (typeof raw !== "string") return raw;
  let b = raw;
  if (folderKind === "simple") {
    b = b.replace(/\b10267\b/g, "{{wcc_simple_booking_id}}");
    b = b.replace(/\b10251\b/g, "{{wcc_simple_booking_id}}");
    b = b.replace(/\b3864\b/g, "{{wcc_simple_contact_id}}");
    b = b.replace(/"id":\s*"251"/g, '"id": "{{wcc_simple_package_id}}"');
    b = b.replace(/"id":\s*251/g, '"id": "{{wcc_simple_package_id}}"');
    b = b.replace(/"id":\s*"44"/g, '"id": "{{wcc_simple_event_id}}"');
    b = b.replace(/"id":\s*44/g, '"id": "{{wcc_simple_event_id}}"');
    b = b.replace(/"id":\s*"8941"/g, '"id": "{{wcc_general_admission_item_id}}"');
    b = b.replace(/"id":\s*8941/g, '"id": "{{wcc_general_admission_item_id}}"');
    b = b.replace(/"id":\s*"14309"/g, '"id": "{{wcc_simple_booking_package_id}}"');
    b = b.replace(/\b14309\b/g, "{{wcc_simple_booking_package_id}}");
    b = b.replace(/"id":\s*"57"/g, '"id": "{{wcc_simple_confirm_status_id}}"');
    b = b.replace(/"id":\s*"13301"/g, '"id": "{{wcc_simple_booking_package_id}}"');
    b = b.replace(/\b13301\b/g, "{{wcc_simple_booking_package_id}}");
    b = b.replace(/BP10267/g, "BP{{wcc_simple_booking_id}}");
  }
  if (folderKind === "complex") {
    b = b.replace(/\b11275\b/g, "{{wcc_complex_booking_id}}");
    b = b.replace(/\b3864\b/g, "{{wcc_shared_contact_id}}");
    b = b.replace(/"id":\s*"76"/g, '"id": "{{wcc_complex_package_id}}"');
    b = b.replace(/"id":\s*76/g, '"id": "{{wcc_complex_package_id}}"');
    b = b.replace(/"id":\s*"8941"/g, '"id": "{{wcc_general_admission_item_id}}"');
    b = b.replace(/"id":\s*8941/g, '"id": "{{wcc_general_admission_item_id}}"');
    b = b.replace(/"id":\s*"53"/g, '"id": "{{wcc_complex_draft_status_id}}"');
    b = b.replace(/"id":\s*"8"/g, '"id": "{{wcc_price_concession_id}}"');
    b = b.replace(/"id":\s*"1476"/g, '"id": "{{wcc_complex_asset_id}}"');
    b = b.replace(/"id":\s*"1835"/g, '"id": "{{wcc_complex_event_configuration_id}}"');
    b = b.replace(/"id":\s*"12913"/g, '"id": "{{wcc_complex_invoice_id}}"');
    b = b.replace(/\b12913\b/g, "{{wcc_complex_invoice_id}}");
    b = b.replace(/BP11275/g, "BP{{wcc_complex_booking_id}}");
  }
  return b;
}

function ensureTestScript(item, name, folderKind) {
  let execText = TEST_SCRIPTS[name];
  if (name === "Invoice Create" && folderKind === "complex") {
    execText = `${saveVar("")}
if (pm.response.code >= 200 && pm.response.code < 300) {
  const json = safeJsonParse(pm.response.text());
  const invId = json && json.data && json.data.id;
  if (invId) saveVar("wcc_complex_invoice_id", invId);
  pm.test("Saved complex invoice id", function () { pm.expect(invId).to.be.ok; });
} else {
  pm.test("Complex Invoice Create failed", function () { pm.expect.fail("status " + pm.response.code); });
}`;
  }
  if (!execText) return;
  item.event = item.event || [];
  const existing = item.event.find((e) => e.listen === "test");
  if (existing && existing.script && Array.isArray(existing.script.exec) && existing.script.exec.some((l) => l.includes("wcc_simple_booking_id"))) {
    return;
  }
  if (existing) {
    existing.script = existing.script || {};
    existing.script.type = "text/javascript";
    existing.script.exec = execText.split("\n");
  } else {
    item.event.push({
      listen: "test",
      script: { type: "text/javascript", exec: execText.split("\n"), packages: {}, requests: {} },
    });
  }
}

function ensurePrerequestClientCreate(item, name) {
  if (name !== "Client Create") return;
  const execText = `
const suffix = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
pm.variables.set("wcc_client_suffix", suffix);
const raw = pm.request.body && pm.request.body.raw;
if (!raw) return;
try {
  const o = JSON.parse(raw);
  if (o.data && o.data.attributes) {
    o.data.attributes.ClientName = "WCC_Load_" + suffix;
  }
  const inc = o.included || [];
  for (let i = 0; i < inc.length; i++) {
    if (inc[i].type === "Contact" && inc[i].attributes) {
      inc[i].attributes.FirstName = "WCC";
      inc[i].attributes.LastName = "Load_" + suffix.slice(-6);
    }
    if (inc[i].type === "CommunicationMethod" && inc[i].attributes && inc[i].attributes.value && inc[i].attributes.value.indexOf("@") > -1) {
      inc[i].attributes.value = "wcc_load_" + suffix + "@example.test";
    }
  }
  pm.request.body.raw = JSON.stringify(o);
} catch (e) { console.warn("Client Create prerequest:", e); }
`.trim();
  item.event = item.event || [];
  const existing = item.event.find((e) => e.listen === "prerequest");
  if (existing) return;
  item.event.push({
    listen: "prerequest",
    script: { type: "text/javascript", exec: execText.split("\n"), packages: {}, requests: {} },
  });
}

function walk(items, folderKind, fn) {
  for (const it of items || []) {
    if (it.item) {
      const name = it.name || "";
      let next = folderKind;
      if (name.includes("Simple booking")) next = "simple";
      else if (name.includes("Complex booking")) next = "complex";
      else if (name.includes("Login")) next = "login";
      walk(it.item, next, fn);
    } else if (it.request) {
      fn(it, folderKind);
    }
  }
}

function renameFolders(items) {
  for (const it of items || []) {
    if (!it.item) continue;
    if (it.name === "Login") it.name = "1 - Login (common)";
    if (it.name && it.name.startsWith("Complex Booking")) it.name = "3 - Complex booking (~20% users)";
    if (it.name && it.name.startsWith("Simple Booking")) it.name = "2 - Simple booking (~80% users)";
    renameFolders(it.item);
  }
}

function reorderRootFolders(items) {
  const login = items.find((x) => x.name && x.name.includes("Login"));
  const simple = items.find((x) => x.name && x.name.includes("Simple booking"));
  const complex = items.find((x) => x.name && x.name.includes("Complex booking"));
  const rest = items.filter((x) => x !== login && x !== simple && x !== complex);
  const out = [];
  if (login) out.push(login);
  if (simple) out.push(simple);
  if (complex) out.push(complex);
  out.push(...rest);
  return out;
}

function main() {
  const src = process.argv[2] || path.join(process.env.USERPROFILE || "", "OneDrive", "Documents", "WCC Booking follow.postman_collection.json");
  if (!fs.existsSync(src)) {
    console.error("Source collection not found:", src);
    console.error("Pass path as first argument.");
    process.exit(1);
  }
  const col = JSON.parse(fs.readFileSync(src, "utf8"));
  col.info = col.info || {};
  col.info.name = (col.info.name || "WCC") + " (Dynamic load-ready)";

  col.event = col.event || [];
  if (!col.event.some((e) => e.listen === "prerequest")) {
    col.event.unshift({
      listen: "prerequest",
      script: { type: "text/javascript", exec: COLLECTION_PREREQUEST.split("\n"), packages: {}, requests: {} },
    });
  }

  renameFolders(col.item);
  col.item = reorderRootFolders(col.item);

  walk(col.item, null, (item, folderKind) => {
    const name = item.name || "";
    if (item.request) {
      if (item.request.url) {
        if (item.request.url.raw) item.request.url.raw = patchUrlRaw(item.request.url.raw, folderKind);
        patchUrlPathArray(item.request.url.path, folderKind);
        patchHeaders(item.request.header);
        if (item.request.body && item.request.body.mode === "raw") {
          item.request.body.raw = patchBodyRaw(item.request.body.raw, folderKind);
        }
      }
    }
    if (folderKind === "simple") {
      ensureTestScript(item, name, folderKind);
      ensurePrerequestClientCreate(item, name);
    }
    if (folderKind === "complex") {
      ensureTestScript(item, name, folderKind);
    }
  });

  const loginFolder = col.item.find((x) => x.name && x.name.includes("Login"));
  const loginReq = loginFolder && loginFolder.item && loginFolder.item[0];
  if (loginReq && loginReq.request && loginReq.request.body && loginReq.request.body.mode === "raw") {
    loginReq.request.body.raw = `{
    "username": "{{login_username}}",
    "password": "{{login_password}}"
}`;
  }

  fs.writeFileSync(OUT, JSON.stringify(col, null, 2), "utf8");
  console.log("Wrote", OUT);
}

main();
