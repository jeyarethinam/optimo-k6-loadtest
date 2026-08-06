import http from "k6/http";
import { BASE_URL, LOGIN_PAYLOAD } from "../data.js";
import { validate, REQUEST_TIMEOUT } from "../../shared/helpers.js";

export function login() {
  const res = http.post(
    `${BASE_URL}/api/V4.1/users/login?fields=token`,
    JSON.stringify(LOGIN_PAYLOAD),
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: REQUEST_TIMEOUT,
    }
  );

  validate(res, "Login");
  const body = res.json();
  const token = body?.meta?.token;
  if (!token) throw new Error("Login token not found");
  return token;
}
