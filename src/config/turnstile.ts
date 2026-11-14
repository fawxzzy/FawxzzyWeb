/**
 * Cloudflare Turnstile (CAPTCHA) client settings for the account portal.
 *
 * The site key is PUBLIC by design (it ships to every browser). The matching secret lives only in
 * the Supabase dashboard and is never in this repository.
 */
export const turnstileConfig = {
  siteKey: "0x4AAAAAAF_zfobNZ7if_F6v",
  scriptOrigin: "https://challenges.cloudflare.com",
  scriptSrc: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  /** Wait this long for the script before telling the person the check could not load. */
  loadTimeoutMs: 10_000,
  /** A submit waits at most this long for an in-flight invisible check, then goes without a token. */
  tokenWaitMs: 4_000,
} as const;
