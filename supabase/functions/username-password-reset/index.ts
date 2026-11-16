// username-password-reset: signed-out password reset by USERNAME (design direction #9).
// PROPOSED, OWNER-GATED: deploying this function and applying
// supabase/proposed/20261115210000_account_username_reset_v1.sql are owner actions (approve by
// sha256). Until both are live the portal keeps the email form (RESET_BY_USERNAME_LIVE in
// src/config/account.ts stays false).
//
// All request logic lives in handler.mjs (node-tested); this file only wires the runtime.
import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { createPublicKeyAdmission } from "../username-password-signin/public-key.mjs";
import {
  createUsernameResetHandler,
  providerPublicKey,
  recipientFrom,
  recoverRequest,
  resolveUsernameResetRpc,
} from "./handler.mjs";

const admitPublicClientKey = createPublicKeyAdmission();

function acceptedPublicKeys() {
  const keys = new Set<string>();
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) keys.add(legacy);
  try {
    const configured = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (Array.isArray(configured)) {
      for (const value of configured) if (typeof value === "string") keys.add(value);
    } else if (configured && typeof configured === "object") {
      for (const value of Object.values(configured)) if (typeof value === "string") keys.add(value);
    }
  } catch {
    // A malformed runtime key map fails closed below.
  }
  return keys;
}

async function isAcceptedPublicKey(requestKey: string) {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) return false;
  return admitPublicClientKey(requestKey, acceptedPublicKeys(), async (candidate: string) => {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: candidate },
      method: "GET",
    });
    return response.ok;
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Work that must not delay the answer (account lookup + provider recovery call). The edge runtime
// keeps the worker alive for it after the response; elsewhere it simply runs un-awaited.
function background(task: Promise<unknown>) {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else task.catch(() => undefined);
}

const handle = createUsernameResetHandler({
  admitKey: isAcceptedPublicKey,
  background,
  async findRecipient(userId: string) {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) return null;
    const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
    const { data } = await admin.auth.admin.getUserById(userId);
    return recipientFrom(data?.user ?? null, Date.now());
  },
  async resolve({ clientKey, normalized, pairKey }: { clientKey: string; normalized: string; pairKey: string }) {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceRole) return null;
    return resolveUsernameResetRpc({
      args: { p_client_key: clientKey, p_normalized_username: normalized, p_pair_key: pairKey },
      fetchImpl: fetch,
      serviceRole,
      url,
    });
  },
  async sendRecovery(input: { captchaToken?: string; codeChallenge: string; email: string; redirectTo: string }) {
    const url = Deno.env.get("SUPABASE_URL");
    // New publishable key first, legacy anon key as the fallback.
    const anonKey = providerPublicKey((name: string) => Deno.env.get(name));
    if (!url || !anonKey) return null;
    const [target, init] = recoverRequest({ ...input, anonKey, url });
    const response = await fetch(target, init);
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  },
  // One non-identifying line per background send (status class only; see handler.mjs).
  log(entry: Record<string, string>) {
    console.log(JSON.stringify(entry));
  },
  sha256,
});

Deno.serve(handle);
