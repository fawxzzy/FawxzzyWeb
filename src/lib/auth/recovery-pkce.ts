/**
 * PKCE for a recovery email that the SERVER asks the provider to send (username reset).
 *
 * The portal's client runs flowType "pkce" and the recovery landing only accepts
 * `?recovery=1&code=...` (parseRecoveryPayload). When the browser calls resetPasswordForEmail the SDK
 * stores a code verifier and sends its challenge; for a username reset the Edge Function makes that
 * provider call instead, so the browser prepares the same verifier/challenge pair here and sends only
 * the challenge. The verifier never leaves this browser, and exchangeCodeForSession on the landing
 * reads it exactly as if the SDK had stored it.
 *
 * Storage format matches @supabase/auth-js 2.x getCodeChallengeAndMethod(storage, key, true): key
 * `${storageKey}-code-verifier`, value JSON.stringify(`${verifier}/recovery`); verifier = 56 random
 * 32-bit values, each rendered as its last two hex digits; challenge = base64url(sha256(verifier)),
 * no padding, method "s256". tests/username-password-reset.test.mjs pins this against the installed SDK.
 */
type VerifierStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  removeItem(key: string): void | Promise<void>;
  setItem(key: string, value: string): void | Promise<void>;
};

export const RECOVERY_PKCE_METHOD = "s256";

export function recoveryVerifierKey(storageKey: string) {
  return `${storageKey}-code-verifier`;
}

function createVerifier() {
  const values = new Uint32Array(56);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => `0${value.toString(16)}`.slice(-2)).join("");
}

export async function challengeFor(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Stores a fresh recovery verifier (replacing any earlier one) and returns its challenge. */
export async function startRecoveryPkce(storage: VerifierStorage, storageKey: string) {
  const verifier = createVerifier();
  await storage.setItem(recoveryVerifierKey(storageKey), JSON.stringify(`${verifier}/recovery`));
  return { codeChallenge: await challengeFor(verifier), codeChallengeMethod: RECOVERY_PKCE_METHOD };
}

/** Drops the stored verifier when the request did not go out. */
export async function clearRecoveryPkce(storage: VerifierStorage, storageKey: string) {
  await storage.removeItem(recoveryVerifierKey(storageKey));
}
