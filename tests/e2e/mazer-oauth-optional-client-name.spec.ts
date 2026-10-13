import { expect, test } from "@playwright/test";
import {
  isExpectedMazerOAuthAuthorization,
  normalizeMazerOAuthProviderResult,
  parseMazerOAuthGatewayResult,
} from "../../src/lib/auth/mazer-oauth";

const authorizationId = "synthetic-authorization-12345";
const origin = "http://127.0.0.1:3210";
const clientId = "local-mazer-oauth-client";
const provider = {
  authorization_id: authorizationId,
  redirect_uri: "https://mazer.fawxzzy.com/",
  scope: "email",
  client: { id: clientId },
  user: { id: "synthetic-user" },
};
const details = {
  clientId, clientName: "", redirectUri: provider.redirect_uri,
  scope: "email", userId: "synthetic-user",
};

for (const [label, client, expectedName] of [
  ["omitted", { id: clientId }, ""],
  ["undefined", { id: clientId, name: undefined }, ""],
  ["empty", { id: clientId, name: "" }, ""],
  ["Mazer", { id: clientId, name: "Mazer" }, "Mazer"],
] as const) {
  test(`Mazer normalizes ${label} provider name without inventing identity`, () => {
    const result = normalizeMazerOAuthProviderResult({ ...provider, client }, authorizationId);
    expect(result).toEqual({ kind: "authorization", details: { ...details, clientName: expectedName } });
    expect(parseMazerOAuthGatewayResult(result)).toEqual(result);
    expect(result?.kind === "authorization" && isExpectedMazerOAuthAuthorization(result.details, origin)).toBe(true);
  });
}

for (const name of [null, 123, false, [], {}, ["Mazer"]]) {
  test(`Mazer rejects present nonstring name ${JSON.stringify(name)}`, () => {
    expect(normalizeMazerOAuthProviderResult({ ...provider, client: { id: clientId, name } }, authorizationId)).toBeNull();
  });
}

test("Mazer never treats a provider client_name alias as display-name or identity evidence", () => {
  expect(normalizeMazerOAuthProviderResult({
    ...provider, client: { id: clientId, client_name: "foreign-provider-value" },
  }, authorizationId)).toEqual({ kind: "authorization", details });
});

for (const [label, changed] of [
  ["client ID", { clientId: "foreign-client" }],
  ["redirect", { redirectUri: "https://attacker.example.test/" }],
  ["scope", { scope: "email profile" }],
  ["foreign name", { clientName: "Other App" }],
  ["whitespace name", { clientName: " " }],
] as const) {
  test(`Mazer rejects wrong ${label} even when optional names are supported`, () => {
    expect(isExpectedMazerOAuthAuthorization({ ...details, ...changed }, origin)).toBe(false);
  });
}

test("Mazer optional names still require the exact configured production client ID", () => {
  const oldId = process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID;
  try {
    delete process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID;
    expect(isExpectedMazerOAuthAuthorization(details, "https://account.fawxzzy.com")).toBe(false);
    process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID = "configured-production-client";
    expect(isExpectedMazerOAuthAuthorization(details, "https://account.fawxzzy.com")).toBe(false);
    expect(isExpectedMazerOAuthAuthorization({ ...details, clientId: "configured-production-client" }, "https://account.fawxzzy.com")).toBe(true);
  } finally {
    if (oldId === undefined) delete process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID;
    else process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID = oldId;
  }
});

test("Mazer optional names preserve authorization, client, and user shape checks", () => {
  for (const invalid of [
    { ...provider, authorization_id: "different-authorization-12345" },
    { ...provider, redirect_uri: null }, { ...provider, scope: [] },
    { ...provider, client: null }, { ...provider, client: { id: 123 } },
    { ...provider, user: null }, { ...provider, user: { id: 123 } },
  ]) {
    expect(normalizeMazerOAuthProviderResult(invalid, authorizationId)).toBeNull();
  }
  expect(normalizeMazerOAuthProviderResult(provider, "invalid")).toBeNull();
});

test("Mazer gateway retains its exact normalized string-only contract", () => {
  for (const invalid of [
    { kind: "authorization", details: { ...details, clientName: undefined } },
    { kind: "authorization", details: { ...details, clientName: null } },
    { kind: "authorization", details: { ...details, extra: true } },
    { kind: "authorization", details, extra: true },
  ]) {
    expect(parseMazerOAuthGatewayResult(invalid)).toBeNull();
  }
});
