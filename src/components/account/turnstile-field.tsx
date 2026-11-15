"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { classifyRuntimeOrigin } from "@/config/account";
import { turnstileConfig } from "@/config/turnstile";
import { waitForCaptchaToken } from "@/lib/auth/captcha";

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileFieldHandle = {
  /** Token for this attempt (waits briefly for the invisible check); undefined when none. */
  getToken(): Promise<string | undefined>;
  /** Tokens are single use: call after every attempt that used one. */
  reset(): void;
};

function whenPageSettled(callback: () => void) {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => !cancelled && callback(), { timeout: 2_000 });
    } else {
      window.setTimeout(() => !cancelled && callback(), 500);
    }
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
  };
}

/**
 * Cloudflare Turnstile widget for the account forms. Renders in "interaction-only" mode: invisible
 * unless Cloudflare needs the person to act. The script loads only on the account origin, after
 * the page has settled. If it cannot load, the form still works and `onUnavailable` lets the screen
 * show its one notice (`captcha.load`, with Retry that remounts this field).
 */
export const TurnstileField = forwardRef<TurnstileFieldHandle, { onUnavailable?: () => void }>(function TurnstileField(
  { onUnavailable },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const tokenRef = useRef<string | undefined>(undefined);
  const unavailableRef = useRef(false);
  // True only while there is something to wait for: the script is loading or a widget exists.
  const pendingRef = useRef(false);
  const [unavailable, setUnavailable] = useState(false);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useImperativeHandle(ref, () => ({
    getToken: () => waitForCaptchaToken(
      { peek: () => tokenRef.current, isUnavailable: () => unavailableRef.current || !pendingRef.current },
      turnstileConfig.tokenWaitMs,
    ),
    reset() {
      tokenRef.current = undefined;
      try {
        if (window.turnstile && widgetIdRef.current !== undefined) {
          window.turnstile.reset(widgetIdRef.current);
        }
      } catch {
        // A failed reset must never block the form.
      }
    },
  }), []);

  useEffect(() => {
    const kind = classifyRuntimeOrigin(window.location.origin);
    // The real script loads only on the account origin. Local test origins use an injected stub.
    const mayLoadScript = kind === "account";
    const markUnavailable = () => {
      pendingRef.current = false;
      unavailableRef.current = true;
      setUnavailable(true);
      onUnavailableRef.current?.();
    };
    let disposed = false;
    let timeout: number | undefined;
    let script: HTMLScriptElement | null = null;

    const render = () => {
      const container = containerRef.current;
      if (disposed || !container || !window.turnstile || widgetIdRef.current !== undefined) return;
      try {
        pendingRef.current = true;
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: turnstileConfig.siteKey,
          appearance: "interaction-only",
          size: "flexible",
          callback: (token: string) => {
            tokenRef.current = token;
          },
          "expired-callback": () => {
            tokenRef.current = undefined;
          },
          "error-callback": () => {
            tokenRef.current = undefined;
            markUnavailable();
          },
        });
      } catch {
        markUnavailable();
      }
    };

    const cancelSettle = whenPageSettled(() => {
      if (window.turnstile) {
        render();
        return;
      }
      if (!mayLoadScript) return;
      script = document.createElement("script");
      script.src = turnstileConfig.scriptSrc;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.clearTimeout(timeout);
        render();
      };
      script.onerror = () => {
        window.clearTimeout(timeout);
        markUnavailable();
      };
      timeout = window.setTimeout(() => {
        if (!window.turnstile) markUnavailable();
      }, turnstileConfig.loadTimeoutMs);
      pendingRef.current = true;
      document.head.appendChild(script);
    });

    return () => {
      disposed = true;
      cancelSettle();
      window.clearTimeout(timeout);
      try {
        if (window.turnstile && widgetIdRef.current !== undefined) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {
        // Ignore.
      }
      widgetIdRef.current = undefined;
      script?.remove();
    };
  }, []);

  return (
    <div className="account-captcha" data-captcha-state={unavailable ? "unavailable" : "ready"}>
      <div data-testid="turnstile-container" ref={containerRef} />
    </div>
  );
});
