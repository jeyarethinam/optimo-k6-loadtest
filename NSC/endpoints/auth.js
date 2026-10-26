import http from "k6/http";
import { API_BASE, jsonHeaders, TEST_PASSWORD } from "../data.js";
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

export function login(email, password = TEST_PASSWORD) {
  const payload = { email, password };
  const body = JSON.stringify(payload);
  const res = http.post(API_BASE + "/customers/login", body, {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "login" },
  });
  return assertAppSuccess(res, "Login", { email }, { requestBody: body });
}

export function getMe(expectedEmail) {
  const res = http.get(API_BASE + "/customers/me", {
    headers: jsonHeaders,
    redirects: 0,
    timeout: REQUEST_TIMEOUT,
    tags: { name: "identity" },
  });
  const me = assertAppSuccess(res, "Identity", {});
  if (
    expectedEmail &&
    me?.email &&
    String(me.email).toLowerCase() !== String(expectedEmail).toLowerCase()
  ) {
    throw new Error(`Identity email mismatch: got ${me.email}, expected ${expectedEmail}`);
  }
  if (!me?.id || !me.phone || !me.concessionGroupId) {
    throw new Error("Identity incomplete (need id, phone, concessionGroupId)");
  }
  return me;
}
