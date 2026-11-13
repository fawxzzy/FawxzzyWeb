import type { PortalAuthAdapter } from "@/lib/auth/browser-adapter";
import { ownerHintCookie } from "@/lib/projects/owner-hint.mjs";
import { fetchOwnerProjects, isOwnerAccessReply } from "@/lib/projects/owner-projects-client";

export function writeOwnerHint(owner: boolean) {
  try {
    document.cookie = ownerHintCookie(owner, window.location.hostname);
  } catch {
    // Cookies can be blocked; the hint is only a convenience.
  }
}

// Asks the server whether the signed-in session is the owner and records the answer as the
// shared hint. Bounded so a slow server can never hold up sign-in navigation.
export async function syncOwnerHint(adapter: PortalAuthAdapter, timeoutMs = 3500) {
  const timeout = new Promise<null>((resolve) => { setTimeout(() => resolve(null), timeoutMs); });
  const reply = await Promise.race([fetchOwnerProjects(adapter, "access"), timeout]).catch(() => null);
  const owner = isOwnerAccessReply(reply);
  writeOwnerHint(owner);
  return owner;
}
