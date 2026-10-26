import http from "k6/http";
import {
  API_BASE,
  jsonHeaders,
  ASSET_ID,
  PACKAGE_ID,
  PACKAGE_NAME_HINT,
  ITEM_ID,
  FROM_DATE,
  TO_DATE,
  SCAN_DAYS,
} from "../data.js";
import { validate, REQUEST_TIMEOUT } from "../../shared/helpers.js";

function assertAppSuccess(res, name, context, options) {
  validate(res, name, context, options);
  let body;
  try {
    body = res.json();
  } catch (_) {
    throw new Error(`${name}: response is not JSON`);
  }
  if (body && body.success === false) {
    const err = new Error(`${name}: API success=false`);
    err.k6Failure = {
      endpoint: name,
      status: res.status,
      responseBody: res.body,
      ...(context || {}),
    };
    throw err;
  }
  return body && body.data !== undefined ? body.data : body;
}

export function getAsset(assetId = ASSET_ID) {
  const res = http.get(API_BASE + `/assets/${assetId}`, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "asset" },
  });
  const asset = assertAppSuccess(res, "Asset", { assetId });
  if (String(asset?.id) !== String(assetId)) throw new Error(`Unexpected asset id ${asset?.id}`);
  return asset;
}

export function getPrivatePackages(assetId = ASSET_ID) {
  const res = http.get(API_BASE + `/products/private-packages?assetId=${assetId}`, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "packages" },
  });
  return assertAppSuccess(res, "Packages", { assetId }) || [];
}

export function selectPackage(packages) {
  const list = Array.isArray(packages) ? packages : [];
  const pkg =
    list.find((p) => String(p.id) === String(PACKAGE_ID)) ||
    list.find((p) => String(p.id) === "113") ||
    list.find(
      (p) =>
        new RegExp(PACKAGE_NAME_HINT, "i").test(p.name || "") &&
        p.isEligible &&
        (!p.packageItems || p.packageItems.length === 0)
    );
  if (!pkg?.isEligible || (pkg.packageItems && pkg.packageItems.length > 0)) {
    throw new Error("Eligible empty-package workflow not found (expected package " + PACKAGE_ID + ")");
  }
  return pkg;
}

export function getItems(assetId, salesCategoryIds) {
  const cats = Array.isArray(salesCategoryIds) ? salesCategoryIds.join(",") : String(salesCategoryIds);
  const res = http.get(API_BASE + `/products/items?assetId=${assetId}&salesCategoryId=${cats}`, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "items" },
  });
  return assertAppSuccess(res, "Items", { assetId }) || [];
}

export function selectItem(items) {
  const item = (items || []).find((i) => String(i.id) === String(ITEM_ID));
  if (!item?.assetIds?.map(String).includes(String(ASSET_ID))) {
    throw new Error(`Item ${ITEM_ID} not available on asset ${ASSET_ID}`);
  }
  if (item.allowImmediateConfirmedBookings === true) {
    throw new Error(`Item ${ITEM_ID} allows immediate confirmed bookings — smoke expects approval flow`);
  }
  return item;
}

export function getTimeslots(assetId = ASSET_ID, fromDate = FROM_DATE, toDate = TO_DATE) {
  const res = http.get(
    API_BASE + `/timeslots?assetIds=${assetId}&fromDate=${fromDate}&toDate=${toDate}`,
    {
      headers: jsonHeaders,
      redirects: 0,
      timeout: REQUEST_TIMEOUT,
      tags: { name: "availability" },
    }
  );
  const slots = assertAppSuccess(res, "Availability", { assetId, fromDate, toDate });
  if (!Array.isArray(slots)) throw new Error("Availability did not return an array");
  return slots;
}

export function findFreeHalfHourSlot(slots, fromDate = FROM_DATE, scanDays = SCAN_DAYS) {
  const startDay = new Date(fromDate + "T00:00:00.000Z");
  const fmt = (m) =>
    String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  for (let offset = 0; offset < scanDays; offset++) {
    const day = new Date(startDay.getTime() + offset * 86400000);
    const candidateDate = day.toISOString().slice(0, 10);
    for (let minutes = 8 * 60; minutes < 18 * 60; minutes += 30) {
      const candidate = { startTime: fmt(minutes), endTime: fmt(minutes + 30) };
      const startIso = candidateDate + "T" + candidate.startTime + ":00";
      const endIso = candidateDate + "T" + candidate.endTime + ":00";
      if (!slots.some((s) => s.startTime < endIso && s.endTime > startIso)) {
        return { date: candidateDate, ...candidate, start: startIso, end: endIso };
      }
    }
  }
  throw new Error("No free half-hour slot in date window");
}

export function getCalculatedPrice(itemId, start, end, concessionGroupId) {
  const path =
    `/products/items/${itemId}/calculated-price` +
    `?startTime=${start}&endTime=${end}&quantity=1` +
    `&priceConcessionId=${encodeURIComponent(concessionGroupId)}`;
  const res = http.get(API_BASE + path, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "price" },
  });
  const price = assertAppSuccess(res, "Price", { itemId });
  if (price?.totalPrice !== 0) {
    throw new Error(`Expected zero-cost journey, got totalPrice=${price?.totalPrice}`);
  }
  if (String(price.concessionId) !== String(concessionGroupId)) {
    throw new Error("Price concession mismatch");
  }
  return price;
}
