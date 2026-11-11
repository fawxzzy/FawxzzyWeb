import { expect, test } from "@playwright/test";
import {
  firstPartyMazerOAuthClientIds,
  FIRST_PARTY_MAZER_REDIRECT_URIS,
  shouldAutoApproveMazerOAuth,
} from "../../src/lib/auth/mazer-oauth";

const localOrigin = "http://127.0.0.1:3210";
const liveOrigin = "https://account.fawxzzy.com";
const productionClientId = "configured-production-client";
const base = {
  clientId: "local-mazer-oauth-client",
  clientName: "Mazer",
  redirectUri: "https://mazer.fawxzzy.com/",
  scope: "email",
  userId: "user-1",
};

function withClientEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID;
  if (value === undefined) delete process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID;
  else process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID;
    else process.env.NEXT_PUBLIC_MAZER_OAUTH_CLIENT_ID = previous;
  }
}

test("allowlist is explicit: one exact redirect URI and the configured client id only", () => {
  expect(FIRST_PARTY_MAZER_REDIRECT_URIS).toEqual(["https://mazer.fawxzzy.com/"]);
  expect(firstPartyMazerOAuthClientIds(localOrigin)).toEqual(["local-mazer-oauth-client"]);
  withClientEnv(productionClientId, () => {
    expect(firstPartyMazerOAuthClientIds(liveOrigin)).toEqual([productionClientId]);
  });
  withClientEnv(undefined, () => {
    expect(firstPartyMazerOAuthClientIds(liveOrigin)).toEqual([]);
  });
});

test("allowlisted client and exact redirect skip the consent card", () => {
  expect(shouldAutoApproveMazerOAuth(base, localOrigin, "user-1")).toBe(true);
  expect(shouldAutoApproveMazerOAuth({ ...base, clientName: "" }, localOrigin, "user-1")).toBe(true);
  withClientEnv(productionClientId, () => {
    expect(shouldAutoApproveMazerOAuth(
      { ...base, clientId: productionClientId },
      liveOrigin,
      "user-1",
    )).toBe(true);
  });
});

test("wrong redirect URI does not skip", () => {
  for (const redirectUri of [
    "https://mazer.fawxzzy.com",
    "https://mazer.fawxzzy.com/callback",
    "https://mazer.fawxzzy.com/?x=1",
    "http://mazer.fawxzzy.com/",
    "https://mazer.fawxzzy.com.attacker.example/",
    "https://attacker.example/https://mazer.fawxzzy.com/",
    "https://MAZER.fawxzzy.com/",
    "",
  ]) {
    expect(shouldAutoApproveMazerOAuth({ ...base, redirectUri }, localOrigin, "user-1"), redirectUri).toBe(false);
  }
});

test("another client does not skip, including name or substring lookalikes", () => {
  for (const clientId of [
    "some-other-client",
    "local-mazer-oauth-client-2",
    "xlocal-mazer-oauth-client",
    "LOCAL-MAZER-OAUTH-CLIENT",
    "",
  ]) {
    expect(shouldAutoApproveMazerOAuth({ ...base, clientId }, localOrigin, "user-1"), clientId).toBe(false);
  }
  // A matching display name never substitutes for the client id.
  expect(shouldAutoApproveMazerOAuth(
    { ...base, clientId: "other", clientName: "Mazer" },
    localOrigin,
    "user-1",
  )).toBe(false);
  // A foreign display name on the right client does not skip.
  expect(shouldAutoApproveMazerOAuth({ ...base, clientName: "Not Mazer" }, localOrigin, "user-1")).toBe(false);
  // The local test client id is not accepted on a live origin.
  withClientEnv(productionClientId, () => {
    expect(shouldAutoApproveMazerOAuth(base, liveOrigin, "user-1")).toBe(false);
  });
  // No configured client id on a live origin: nothing is allowlisted.
  withClientEnv(undefined, () => {
    expect(shouldAutoApproveMazerOAuth(base, liveOrigin, "user-1")).toBe(false);
  });
});

test("missing or mistyped parameters do not skip", () => {
  expect(shouldAutoApproveMazerOAuth(null, localOrigin, "user-1")).toBe(false);
  expect(shouldAutoApproveMazerOAuth(undefined, localOrigin, "user-1")).toBe(false);
  expect(shouldAutoApproveMazerOAuth({}, localOrigin, "user-1")).toBe(false);
  for (const key of ["clientId", "redirectUri", "scope", "userId"] as const) {
    const partial: Record<string, unknown> = { ...base };
    delete partial[key];
    expect(shouldAutoApproveMazerOAuth(partial, localOrigin, "user-1"), key).toBe(false);
    expect(shouldAutoApproveMazerOAuth({ ...partial, [key]: 7 }, localOrigin, "user-1"), key).toBe(false);
  }
  expect(shouldAutoApproveMazerOAuth({ ...base, scope: "email profile" }, localOrigin, "user-1")).toBe(false);
  expect(shouldAutoApproveMazerOAuth({ ...base, scope: "" }, localOrigin, "user-1")).toBe(false);
  expect(shouldAutoApproveMazerOAuth({ ...base, clientName: null as unknown as string }, localOrigin, "user-1")).toBe(false);
});

test("a session user that differs from the authorization user does not skip", () => {
  expect(shouldAutoApproveMazerOAuth(base, localOrigin, "user-2")).toBe(false);
  expect(shouldAutoApproveMazerOAuth(base, localOrigin, "")).toBe(false);
  expect(shouldAutoApproveMazerOAuth(base, localOrigin, null)).toBe(false);
  expect(shouldAutoApproveMazerOAuth(base, localOrigin, undefined)).toBe(false);
});
