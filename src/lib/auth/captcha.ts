/**
 * Token plumbing for Supabase Auth CAPTCHA. Supabase ignores `captchaToken` while CAPTCHA is
 * disabled, so always passing it when we have one is safe before enforcement is switched on.
 */
export function captchaOptions(captchaToken?: string | null): { captchaToken?: string } {
  const token = typeof captchaToken === "string" ? captchaToken.trim() : "";
  return token ? { captchaToken: token } : {};
}

export type CaptchaTokenSource = {
  /** Current token, or undefined when none is ready. */
  peek(): string | undefined;
  /** True once the widget is known not to load or to have failed. */
  isUnavailable(): boolean;
};

/**
 * Resolves the token for a submit: immediately when ready or when the widget is unavailable,
 * otherwise waits up to `timeoutMs` for the invisible check, then resolves undefined. Never rejects
 * and never waits forever, so a broken widget cannot hang a form.
 */
export function waitForCaptchaToken(
  source: CaptchaTokenSource,
  timeoutMs: number,
  pollMs = 100,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const token = source.peek();
      if (token) return resolve(token);
      if (source.isUnavailable() || Date.now() - started >= timeoutMs) return resolve(undefined);
      setTimeout(tick, pollMs);
    };
    tick();
  });
}
