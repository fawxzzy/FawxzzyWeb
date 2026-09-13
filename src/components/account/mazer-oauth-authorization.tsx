"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { accountContract, classifyRuntimeOrigin } from "@/config/account";
import { resolvePortalAuthAdapter } from "@/lib/auth/browser-adapter";
import {
  isExpectedMazerOAuthAuthorization,
  isValidMazerAuthorizationId,
  MAZER_OAUTH_AUTHORIZATION_PATH,
  MAZER_OAUTH_PENDING_KEY,
  normalizeMazerOAuthAuthorizationResult,
  parsePendingMazerOAuthAuthorization,
  sanitizeMazerOAuthRedirect,
  serializePendingMazerOAuthAuthorization,
  type MazerOAuthAuthorizationDetails,
} from "@/lib/auth/mazer-oauth";
import { SystemState } from "@/components/system/system-state";

type AuthorizationState =
  | { kind: "loading" }
  | { kind: "consent"; details: MazerOAuthAuthorizationDetails }
  | { kind: "invalid" }
  | { kind: "unavailable" };

const emptySubscribe = () => () => undefined;

function localScenario() {
  return classifyRuntimeOrigin(window.location.origin) === "local-test"
    ? new URLSearchParams(window.location.search).get("auth_test")
    : null;
}

function loginDestination() {
  const url = new URL(accountContract.loginPath, accountContract.canonicalOrigin);
  url.searchParams.set("app", "mazer");
  url.searchParams.set("returnTo", MAZER_OAUTH_AUTHORIZATION_PATH);
  const scenario = localScenario();
  if (scenario) url.searchParams.set("auth_test", scenario);
  return `${url.pathname}${url.search}`;
}

function clearPendingAuthorization() {
  try {
    window.localStorage.removeItem(MAZER_OAUTH_PENDING_KEY);
  } catch {
    // The unavailable state below handles browsers without durable local storage.
  }
}

export function MazerOAuthAuthorization() {
  const started = useRef(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<AuthorizationState>({ kind: "loading" });
  const hydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const resolution = useMemo(
    () => hydrated ? resolvePortalAuthAdapter(window.location) : null,
    [hydrated],
  );

  useEffect(() => {
    if (!resolution) return;
    if (started.current) return;
    started.current = true;
    const query = new URLSearchParams(window.location.search);
    const incomingIds = query.getAll("authorization_id");
    if (incomingIds.length > 0) {
      const incomingAuthorizationId = incomingIds.length === 1 ? incomingIds[0] : null;
      const serialized = incomingAuthorizationId
        ? serializePendingMazerOAuthAuthorization(incomingAuthorizationId)
        : null;
      if (!serialized) {
        void Promise.resolve().then(() => setState({ kind: "invalid" }));
        return;
      }
      try {
        window.localStorage.setItem(MAZER_OAUTH_PENDING_KEY, serialized);
      } catch {
        void Promise.resolve().then(() => setState({ kind: "unavailable" }));
        return;
      }
      query.delete("authorization_id");
      const cleanQuery = classifyRuntimeOrigin(window.location.origin) === "local-test"
        ? query.toString()
        : "";
      window.location.replace(
        `${MAZER_OAUTH_AUTHORIZATION_PATH}${cleanQuery ? `?${cleanQuery}` : ""}`,
      );
      return;
    }

    let storedAuthorizationId: string | null = null;
    try {
      storedAuthorizationId = parsePendingMazerOAuthAuthorization(
        window.localStorage.getItem(MAZER_OAUTH_PENDING_KEY),
      )?.authorizationId ?? null;
    } catch {
      void Promise.resolve().then(() => setState({ kind: "unavailable" }));
      return;
    }
    if (!isValidMazerAuthorizationId(storedAuthorizationId)) {
      void Promise.resolve().then(() => setState({ kind: "invalid" }));
      return;
    }
    if (resolution.status !== "ready") {
      void Promise.resolve().then(() => setState({ kind: "unavailable" }));
      return;
    }

    resolution.adapter
      .getSession()
      .then((session) => {
        if (!session) {
          window.location.replace(loginDestination());
          return null;
        }
        return resolution.adapter.getOAuthAuthorization(storedAuthorizationId);
      })
      .then((rawDetails) => {
        if (rawDetails === null) return;
        const result = normalizeMazerOAuthAuthorizationResult(rawDetails);
        if (!result) {
          setState({ kind: "invalid" });
          return;
        }
        if (result.kind === "redirect") {
          const destination = sanitizeMazerOAuthRedirect(result.redirectUrl);
          if (!destination) {
            setState({ kind: "invalid" });
            return;
          }
          clearPendingAuthorization();
          if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
            document.documentElement.dataset.oauthRedirect = destination;
          } else {
            window.location.assign(destination);
          }
          return;
        }
        if (!isExpectedMazerOAuthAuthorization(result.details, window.location.origin)) {
          setState({ kind: "invalid" });
          return;
        }
        setState({ kind: "consent", details: result.details });
      })
      .catch(() => setState({ kind: "unavailable" }));
  }, [resolution]);

  async function decide(decision: "approve" | "deny") {
    if (state.kind !== "consent" || resolution?.status !== "ready" || busy) return;
    setBusy(true);
    try {
      const session = await resolution.adapter.getSession();
      if (!session || session.userId !== state.details.userId) {
        window.location.replace(loginDestination());
        return;
      }
      const rawRedirect = decision === "approve"
        ? await resolution.adapter.approveOAuthAuthorization(state.details.authorizationId)
        : await resolution.adapter.denyOAuthAuthorization(state.details.authorizationId);
      const destination = sanitizeMazerOAuthRedirect(rawRedirect);
      if (!destination) {
        setState({ kind: "invalid" });
        return;
      }
      clearPendingAuthorization();
      if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
        document.documentElement.dataset.oauthRedirect = destination;
      } else {
        window.location.assign(destination);
      }
    } catch {
      setState({ kind: "unavailable" });
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return <SystemState compact description="Checking this Mazer sign-in request…" title="One moment." variant="pending" />;
  }
  if (state.kind === "invalid") {
    return <SystemState compact description="This Mazer sign-in request is invalid or expired. Start again from Mazer." title="This request cannot continue." variant="invalid" />;
  }
  if (state.kind === "unavailable") {
    return <SystemState compact description="The secure Mazer sign-in connection is unavailable right now. Start again from Mazer." title="Mazer sign-in is unavailable." variant="unavailable" />;
  }

  return (
    <section
      aria-labelledby="mazer-oauth-title"
      className="account-card account-card--auth"
      data-auth-product="mazer"
      data-auth-surface="oauth-consent"
      style={{ "--auth-accent": "53 238 224" } as React.CSSProperties}
    >
      <header className="account-auth-intro">
        <p>Mazer</p>
        <h1 id="mazer-oauth-title">Continue to Mazer?</h1>
        <span>Mazer will use your Fawxzzy email to open the same account.</span>
      </header>
      <div className="account-auth-dock">
        <button className="catalog-button catalog-button--primary" disabled={busy} onClick={() => void decide("approve")} type="button">
          {busy ? "Working…" : "Continue to Mazer"}
        </button>
        <button className="account-inline-link" disabled={busy} onClick={() => void decide("deny")} type="button">
          Cancel
        </button>
      </div>
    </section>
  );
}
