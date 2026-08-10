import http from "k6/http";
import { BASE_URL } from "../data.js";
import { getHeaders, validate } from "../../shared/helpers.js";

export function clientCategory(token) {
  const res = http.get(
    `${BASE_URL}/api/V4.1/customers/client-categories`,
    getHeaders(token)
  );
  validate(res, "Client Category");
  const data = res.json()?.data || [];
  const active = data.find((x) => x?.attributes?.active === true) || data[0];
  return active?.id || null;
}

export function clientType(token) {
  const res = http.get(
    `${BASE_URL}/api/V4.1/customers/client-types`,
    getHeaders(token)
  );
  validate(res, "Client Type");
  return res.json()?.data?.[0]?.id || null;
}

export function clientTitle(token) {
  const res = http.get(
    `${BASE_URL}/api/V4.1/customers/titles`,
    getHeaders(token)
  );
  validate(res, "Client Title");
  const data = res.json()?.data || [];
  const title = data.find((t) => (t?.attributes?.name || "").trim() !== "") || data[0];
  return {
    titleId: title?.id || null,
    titleName: title?.attributes?.name || null,
  };
}

export function communicationTypes(token) {
  const res = http.get(
    `${BASE_URL}/api/V4.1/customers/communication-types`,
    getHeaders(token)
  );
  validate(res, "Communication Types");
  const data = res.json()?.data || [];
  const find = (name) => data.find((x) => x?.attributes?.name === name)?.id;
  return {
    officeEmailId: find("Office Email"),
    personalEmailId: find("Personal Email"),
    mobileId: find("Mobile"),
    homePhoneId: find("Home Phone"),
  };
}

export function country(token) {
  const res = http.get(
    `${BASE_URL}/api/V4.1/customers/countries`,
    getHeaders(token)
  );
  validate(res, "Country");
  const data = res.json()?.data || [];
  const valid = data.filter((x) => x?.attributes?.name);
  const random = valid[Math.floor(Math.random() * valid.length)] || valid[0];
  return {
    countryId: random?.id || null,
    countryName: random?.attributes?.name || null,
  };
}

export function createClient(token, clientCategoryId, clientTypeId, titleId, officeEmailId, personalEmailId, mobileId, homePhoneId, countryId) {
  // Short but collision-resistant key: base36 time + VU + iter + 4-digit random (no duplicated long prefix on first+last).
  const uniqueTs = Date.now();
  const uniqueKey = `${uniqueTs.toString(36)}_${__VU ?? 0}_${__ITER ?? 0}_${Math.floor(Math.random() * 1e4)}`;
  const today = new Date();
  const todayISO = today.toISOString();

  const firstName = "Load";
  const lastName = uniqueKey;
  const clientName = `Load ${uniqueKey}`;

  // Use dynamic communication values but keep communication types aligned with the server IDs we looked up.
  const phoneTypeId = mobileId || homePhoneId;
  const phoneTail = 1000 + (uniqueTs % 9000);
  const phoneValue = `+380 99 601 ${phoneTail}`;

  // Prefer personal email, but fall back to office email if personal isn't available.
  const emailTypeId = personalEmailId || officeEmailId;
  // Use separate unique emails for client-level and contact-level to avoid any
  // "email already exists" uniqueness rules on the backend.
  const clientEmailValue = `loadtest_client_${uniqueKey}@example.com`;
  const contactEmailValue = `loadtest_contact_${uniqueKey}@example.com`;

  const accountManagerId = __ENV.ACCOUNT_MANAGER_ID || "2";

  const city = `Lviv_${uniqueTs % 1000}`;
  const address1 = `${city} city`;
  const postCode = String(10000 + (uniqueTs % 90000));

  const rootCommunicationMethodData = [];
  const contactCommunicationMethodData = [];
  const includedCommunicationMethods = [];

  // Mirror your shared payload: root has two communicationMethods, contact has another two (separate included ids).
  if (phoneTypeId) {
    includedCommunicationMethods.push(
      { type: "CommunicationMethod", id: "-1", attributes: { communicationTypeID: phoneTypeId, value: phoneValue } },
      { type: "CommunicationMethod", id: "-2", attributes: { communicationTypeID: emailTypeId, value: clientEmailValue } },
      { type: "CommunicationMethod", id: "-3", attributes: { communicationTypeID: phoneTypeId, value: phoneValue } },
      { type: "CommunicationMethod", id: "-4", attributes: { communicationTypeID: emailTypeId, value: contactEmailValue } }
    );
    rootCommunicationMethodData.push(
      { id: "-1", type: "CommunicationMethod" },
      { id: "-2", type: "CommunicationMethod" }
    );
    contactCommunicationMethodData.push(
      { id: "-3", type: "CommunicationMethod" },
      { id: "-4", type: "CommunicationMethod" }
    );
  } else {
    // Fallback: if no phone type id exists, only include the email communicationMethod.
    includedCommunicationMethods.push({
      type: "CommunicationMethod",
      id: "-1",
      attributes: { communicationTypeID: emailTypeId, value: clientEmailValue },
    });
    rootCommunicationMethodData.push({ id: "-1", type: "CommunicationMethod" });
    contactCommunicationMethodData.push({ id: "-1", type: "CommunicationMethod" });
  }

  const payload = {
    data: {
      type: "CorporateClient",
      tid: "-1",
      attributes: {
        Active: true,
        ClientName: clientName,
        ClientCategoryId: clientCategoryId,
        ClientTypeId: clientTypeId,
        DateRegistered: todayISO,
        FirstName: firstName,
        LastName: lastName,
      },
      relationships: {
        accountManager: { data: { id: String(accountManagerId), type: "user" } },
        address: { data: { id: "-1", type: "Address" } },
        communicationMethods: {
          data: rootCommunicationMethodData,
        },
        contacts: { data: [{ id: "-1", type: "Contact" }] },
      },
    },
    included: [
      ...includedCommunicationMethods,

      // Address
      {
        type: "Address",
        id: "-1",
        attributes: {
          city: city,
          county: "",
          Address1: address1,
          PostCode: postCode,
          countryId: countryId,
        },
      },

      // Contact-level communicationMethods (separate included ids, to mirror your sample payload)
      {
        type: "Contact",
        id: "-1",
        attributes: {
          Active: true,
          DateRegistered: todayISO,
          FirstName: firstName,
          isSameAsClientAddress: true,
          DecisionMaker: false,
          LastName: lastName,
        },
        relationships: {
          communicationMethods: { data: contactCommunicationMethodData },
        },
      },
    ],
  };

  const res = http.post(`${BASE_URL}/api/V4.1/customers/clients`, JSON.stringify(payload), getHeaders(token));
  validate(res, "Create Client", null, { requestBody: payload });

  const body = res.json() || {};
  const contacts = body?.data?.relationships?.contacts?.data || [];
  return {
    contactId: contacts?.[0]?.id || null,
    clientId: body?.data?.id || null,
    contactEmail: contactEmailValue,
  };
}