/**
 * ECOM k6 config. Env (__ENV / .env via runner) overrides these defaults.
 */

function envStr(name, fallback = "") {
  const v = __ENV[name];
  return v !== undefined && String(v).trim() !== "" ? String(v).trim() : fallback;
}

export const BASE_URL = envStr(
  "BASE_URL",
  "https://optimodevv5-apis-a2a8g7ehdma3h0df.eastus-01.azurewebsites.net/restapi"
).replace(/\/+$/, "");

export const LOGIN_PAYLOAD = {
  username: envStr("USERNAME", "optimo"),
  password: envStr("PASSWORD", "28N@pD3jTaz"),
};
