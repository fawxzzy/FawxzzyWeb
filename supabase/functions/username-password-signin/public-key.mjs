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
