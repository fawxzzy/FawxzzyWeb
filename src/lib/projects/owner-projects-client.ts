import type { PortalAuthAdapter } from "@/lib/auth/browser-adapter";

// Projects is the owner's private view. The browser never decides who the owner
// is: it sends the signed-in Auth bearer to the account-origin endpoints below,
// and only the server (which holds the owner subject) answers 200. Everything
// else, including "no session", resolves to null and shows nothing.
const BEARER = /^[\x21-\x7e]{16,16384}$/u;

export type OwnerProjectsEndpoint = "access" | "board";

export async function fetchOwnerProjects(
  adapter: PortalAuthAdapter,
  endpoint: OwnerProjectsEndpoint,
  signal?: AbortSignal,
): Promise<unknown | null> {
  try {
    const session = await adapter.getSession();
    if (!session?.userId || signal?.aborted) return null;
    const bearer = await adapter.getOAuthAccessToken(session.userId);
    if (typeof bearer !== "string" || !BEARER.test(bearer) || signal?.aborted) return null;
    const response = await fetch(`/api/projects/${endpoint}`, {
      cache: "no-store",
      credentials: "omit",
      headers: { Authorization: `Bearer ${bearer}`, "X-Fawxzzy-Projects": "1" },
      method: "GET",
      redirect: "error",
      signal,
    });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export function isOwnerAccessReply(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as { owner?: unknown }).owner === true;
}
