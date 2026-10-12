import { expect, test } from "@playwright/test";
import { GET, POST, PUT } from "../../api/account/mazer-oauth-pending";

const endpoint = "https://account.fawxzzy.com/api/account/mazer-oauth-pending";
const authorizationId = "synthetic-private-authorization-12345";
const authGeneration = "a".repeat(64);
const accessToken = `${"a".repeat(32)}.${"b".repeat(32)}.${"c".repeat(32)}`;
const providerKey = "sb_publishable_synthetic_private_test_value";
const sensitive = "SYNTHETIC_PRIVATE_PROVIDER_DIAGNOSTIC";
const state = "b".repeat(43);

async function carrier() {
  const result = await POST(new Request(endpoint, {
    method: "POST",
    headers: { Origin: "https://account.fawxzzy.com", "Content-Type": "application/json" },
    body: JSON.stringify({ authorizationId, authGeneration }),
  }));
  expect(result.status).toBe(204);
  return result.headers.get("set-cookie")!.split(";", 1)[0];
}

function request(cookie: string, operation: "read" | "approve" | "deny") {
  return new Request(endpoint, {
    method: operation === "read" ? "GET" : "PUT",
    headers: {
      Origin: "https://account.fawxzzy.com",
      "Content-Type": "application/json",
      Cookie: cookie,
      Authorization: `Bearer ${accessToken}`,
      "X-Fawxzzy-Auth-Generation": authGeneration,
    },
    ...(operation === "read" ? {} : { body: JSON.stringify({ action: operation, authGeneration }) }),
  });
}

async function withMock(
  upstream: () => Promise<Response>,
  run: (warnings: string[], calls: () => number) => Promise<void>,
) {
  const oldFetch = globalThis.fetch;
  const oldWarn = console.warn;
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const warnings: string[] = [];
  let calls = 0;
  globalThis.fetch = async () => { calls++; return upstream(); };
  console.warn = (...values: unknown[]) => { warnings.push(JSON.stringify(values)); };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://bxtcuhkotumitoqtrcej.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = providerKey;
  try {
    await run(warnings, () => calls);
  } finally {
    globalThis.fetch = oldFetch;
    console.warn = oldWarn;
    if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
  }
}

function warning(warnings: string[]) {
  expect(warnings).toHaveLength(1);
  const args = JSON.parse(warnings[0]) as string[];
  expect(args).toHaveLength(1);
  for (const privateValue of [authorizationId, authGeneration, accessToken, providerKey, sensitive, endpoint]) {
    expect(warnings[0]).not.toContain(privateValue);
  }
  return JSON.parse(args[0]);
}

const failures: Array<{ name: string; stage: string; make: () => Promise<Response>; status?: number }> = [
  { name: "transport", stage: "transport", make: async () => { throw new Error(sensitive); } },
  ...[301, 401, 403, 404, 500, 502].map((status) => ({
    name: `HTTP ${status}`, stage: "upstream_status", status,
    make: async () => new Response(sensitive, { status }),
  })),
  { name: "body read", stage: "response_read", make: async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error(sensitive)); },
  })) },
  { name: "size", stage: "response_size", make: async () => new Response(sensitive.repeat(1_000)) },
  { name: "JSON", stage: "response_json", make: async () => new Response(sensitive) },
  { name: "contract", stage: "response_contract", make: async () => Response.json({ private: sensitive }) },
  { name: "redirect", stage: "redirect_contract", make: async () => Response.json({ redirect_url: `https://attacker.example.test/${sensitive}` }) },
  { name: "unexpected", stage: "unexpected", make: async () => ({ get ok() { throw new Error(sensitive); } } as Response) },
];

for (const operation of ["read", "approve", "deny"] as const) {
  for (const failure of failures) {
    test(`Mazer provider diagnostic ${operation}: ${failure.name} is private and never retried`, async () => {
      const cookie = await carrier();
      await withMock(failure.make, async (warnings, calls) => {
        const result = await (operation === "read" ? GET : PUT)(request(cookie, operation));
        expect(result.status).toBe(502);
        expect(await result.text()).toBe("");
        expect(result.headers.get("cache-control")).toContain("no-store");
        expect(calls()).toBe(1);
        expect(warning(warnings)).toEqual({
          event: "mazer_oauth_provider_failure", operation, stage: failure.stage,
          ...(failure.status === undefined ? {} : { upstreamStatus: failure.status }),
          ...(operation === "read" && failure.stage === "response_contract"
            ? { contractIssue: "authorization_id" }
            : {}),
        });
        if (operation === "read" && failure.stage !== "redirect_contract") {
          expect(result.headers.get("set-cookie")).toBeNull();
        } else {
          expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
        }
      });
    });
  }
}

for (const mode of ["missing", "wrong-master"] as const) {
  test(`Mazer provider diagnostic configuration ${mode} performs no upstream fetch`, async () => {
    await withMock(async () => { throw new Error("fetch must not run"); }, async (warnings, calls) => {
      if (mode === "missing") delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = "https://other.example.test";
      const result = await GET(request(await carrier(), "read"));
      expect(result.status).toBe(502);
      expect(calls()).toBe(0);
      expect(warning(warnings)).toEqual({ event: "mazer_oauth_provider_failure", operation: "read", stage: "configuration" });
    });
  });
}

test("Mazer diagnostics preserve request guards without warning or upstream effects", async () => {
  await withMock(async () => { throw new Error("fetch must not run"); }, async (warnings, calls) => {
    expect((await GET(new Request(endpoint))).status).toBe(404);
    const cookie = await carrier();
    expect((await GET(new Request(endpoint, { headers: { Cookie: cookie } }))).status).toBe(401);
    const invalid = request(cookie, "approve");
    invalid.headers.set("Origin", "https://attacker.example.test");
    expect((await PUT(invalid)).status).toBe(403);
    expect(calls()).toBe(0);
    expect(warnings).toEqual([]);
  });
});

test("Mazer diagnostics do not log successful authorization or consent", async () => {
  await withMock(async () => Response.json({
    authorization_id: authorizationId, client: { id: "synthetic-client", name: "Mazer" },
    redirect_uri: "https://mazer.fawxzzy.com/", scope: "email", user: { id: "synthetic-user" },
  }), async (warnings) => {
    expect((await GET(request(await carrier(), "read"))).status).toBe(200);
    expect(warnings).toEqual([]);
  });
  await withMock(async () => Response.json({ redirect_url: `https://mazer.fawxzzy.com/?code=synthetic&state=${state}` }), async (warnings) => {
    expect((await PUT(request(await carrier(), "approve"))).status).toBe(200);
    expect(warnings).toEqual([]);
  });
});

test("Mazer logging failure still returns502 and clears uncertain consent", async () => {
  await withMock(async () => { throw new Error(sensitive); }, async (_warnings, calls) => {
    console.warn = () => { throw new Error("synthetic logger failure"); };
    const result = await PUT(request(await carrier(), "deny"));
    expect(result.status).toBe(502);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(calls()).toBe(1);
  });
});

const authorizationDetails = {
  authorization_id: authorizationId,
  redirect_uri: "https://mazer.fawxzzy.com/",
  scope: "email",
  client: { id: "synthetic-client", name: "Mazer" },
  user: { id: "synthetic-user" },
};

const contractCases: Array<{ issue: string; value: unknown }> = [
  ...[null, [], sensitive].map((value) => ({ issue: "response_object", value })),
  { issue: "authorization_id", value: { ...authorizationDetails, authorization_id: sensitive } },
  { issue: "authorization_id", value: { redirect_uri: sensitive, scope: null, client: null } },
  { issue: "redirect_uri", value: { ...authorizationDetails, redirect_uri: { private: sensitive } } },
  { issue: "scope", value: { ...authorizationDetails, scope: [sensitive] } },
  { issue: "client_object", value: { ...authorizationDetails, client: null } },
  { issue: "client_object", value: { ...authorizationDetails, client: [sensitive] } },
  { issue: "client_id", value: { ...authorizationDetails, client: { client_id: sensitive, name: "Mazer" } } },
  { issue: "client_name", value: { ...authorizationDetails, client: { id: "synthetic-client", client_name: sensitive } } },
  { issue: "user_object", value: { ...authorizationDetails, user: null } },
  { issue: "user_id", value: { ...authorizationDetails, user: { id: 123, email: sensitive } } },
];

for (const [index, item] of contractCases.entries()) {
  test(`Mazer rejected authorization exposes only fixed contract issue ${index}: ${item.issue}`, async () => {
    await withMock(async () => Response.json(item.value), async (warnings, calls) => {
      const result = await GET(request(await carrier(), "read"));
      expect(result.status).toBe(502);
      expect(await result.text()).toBe("");
      expect(result.headers.get("set-cookie")).toBeNull();
      expect(calls()).toBe(1);
      expect(warning(warnings)).toEqual({
        event: "mazer_oauth_provider_failure", operation: "read",
        stage: "response_contract", contractIssue: item.issue,
      });
    });
  });
}

test("Mazer ignores provider-supplied diagnostic keys and preserves valid authorization", async () => {
  await withMock(async () => Response.json({ ...authorizationDetails, contractIssue: sensitive, private: sensitive }), async (warnings) => {
    const result = await GET(request(await carrier(), "read"));
    expect(result.status).toBe(200);
    expect(await result.text()).not.toContain(sensitive);
    expect(warnings).toEqual([]);
  });
});
