const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/;

function decodeLegacyRole(key) {
  const segments = key.split(".");
  if (segments.length !== 3) return null;
  try {
    const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded));
    return typeof decoded?.role === "string" ? decoded.role : null;
  } catch {
    return null;
  }
}

export function isPublicClientKeyShape(key) {
  if (PUBLISHABLE_KEY.test(key)) return true;
  return decodeLegacyRole(key) === "anon";
}

export async function validatePublicClientKey(requestKey, knownKeys, validateAgainstProject) {
  if (!isPublicClientKeyShape(requestKey)) return false;
  if (knownKeys.has(requestKey)) return true;
  try {
    return await validateAgainstProject(requestKey);
  } catch {
    return false;
  }
}

export function createPublicKeyAdmission({
  cacheTtlMs = 10 * 60 * 1000,
  maxCacheEntries = 8,
  maxRemoteValidations = 8,
  now = () => Date.now(),
  windowMs = 60 * 1000,
} = {}) {
  const validated = new Map();
  let remoteWindowStartedAt = 0;
  let remoteValidationCount = 0;

  return async function admitPublicClientKey(requestKey, knownKeys, validateAgainstProject) {
    if (!isPublicClientKeyShape(requestKey)) return false;
    if (knownKeys.has(requestKey)) return true;

    const currentTime = now();
    const cachedUntil = validated.get(requestKey);
    if (typeof cachedUntil === "number" && cachedUntil > currentTime) return true;
    if (cachedUntil !== undefined) validated.delete(requestKey);

    if (currentTime - remoteWindowStartedAt >= windowMs) {
      remoteWindowStartedAt = currentTime;
      remoteValidationCount = 0;
    }
    if (remoteValidationCount >= maxRemoteValidations) return false;
    remoteValidationCount += 1;

    let accepted = false;
    try {
      accepted = await validateAgainstProject(requestKey);
    } catch {
      return false;
    }
    if (!accepted) return false;

    if (validated.size >= maxCacheEntries) {
      const oldest = validated.keys().next().value;
      if (oldest !== undefined) validated.delete(oldest);
    }
    validated.set(requestKey, currentTime + cacheTtlMs);
    return true;
  };
}
