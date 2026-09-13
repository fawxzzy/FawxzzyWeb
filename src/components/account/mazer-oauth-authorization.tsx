"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  accountContract,
  accountExperienceContexts,
  classifyRuntimeOrigin,
} from "@/config/account";
import { resolvePortalAuthAdapter } from "@/lib/auth/browser-adapter";
import {
  clearPendingMazerOAuthAuthorization,
  decidePendingMazerOAuthAuthorization,
  isExpectedMazerOAuthAuthorization,
  isValidAuthGeneration,
  isValidMazerAuthorizationId,
  MAZER_OAUTH_AUTHORIZATION_PATH,
  readPendingMazerOAuthAuthorization,
  rebindPendingMazerOAuthAuthorization,
  sanitizeMazerOAuthApprovalRedirect,
  sanitizeMazerOAuthDenialRedirect,
  storePendingMazerOAuthAuthorization,
  type MazerOAuthAuthorizationDetails,
} from "@/lib/auth/mazer-oauth";
import { AccountLegalLinks } from "@/components/account/account-legal-links";
import { SystemState } from "@/components/system/system-state";

type AuthorizationState =
  | { kind: "loading" }
  | {
      kind: "consent";
      authGeneration: string;
      details: MazerOAuthAuthorizationDetails;
    }
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

function navigateToMazer(destination: string) {
  if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
    document.documentElement.dataset.oauthRedirect = destination;
  } else {
    window.location.assign(destination);
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
    if (!resolution || started.current) return;
    started.current = true;
    let active = true;

    async function start() {
      if (resolution?.status !== "ready") {
        if (active) setState({ kind: "unavailable" });
        return;
      }

      const query = new URLSearchParams(window.location.search);
      const incomingIds = query.getAll("authorization_id");
      if (incomingIds.length > 0) {
        const incomingAuthorizationId = incomingIds.length === 1 ? incomingIds[0] : null;
        const authGeneration = resolution.adapter.getAuthGeneration();
        if (
          !isValidMazerAuthorizationId(incomingAuthorizationId) ||
          !isValidAuthGeneration(authGeneration)
        ) {
          if (active) setState({ kind: "invalid" });
          return;
        }
        const stored = await storePendingMazerOAuthAuthorization(
          incomingAuthorizationId,
          authGeneration,
        );
        if (!stored) {
          if (active) setState({ kind: "unavailable" });
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

      const authGeneration = resolution.adapter.getAuthGeneration();
      if (!isValidAuthGeneration(authGeneration)) {
        await clearPendingMazerOAuthAuthorization();
        if (active) setState({ kind: "unavailable" });
        return;
      }

      const session = await resolution.adapter.getSession();
      if (!session) {
        window.location.replace(loginDestination());
        return;
      }

      // A normal sign-in advances the durable generation. Rebind the hidden
      // provider handle once, without ever returning it to page JavaScript.
      const rebound = await rebindPendingMazerOAuthAuthorization(authGeneration);
      if (!rebound) {
        if (active) setState({ kind: "invalid" });
        return;
      }

      const accessToken = await resolution.adapter.getOAuthAccessToken(session.userId);
      if (
        resolution.adapter.getAuthGeneration() !== authGeneration ||
        (await resolution.adapter.getSession())?.userId !== session.userId
      ) {
        await clearPendingMazerOAuthAuthorization();
        if (active) setState({ kind: "invalid" });
        return;
      }

      const result = await readPendingMazerOAuthAuthorization(accessToken, authGeneration);
      if (!result) {
        if (active) setState({ kind: "invalid" });
        return;
      }
      if (result.kind === "redirect") {
        const destination = sanitizeMazerOAuthApprovalRedirect(result.redirectUrl);
        if (!destination) {
          if (active) setState({ kind: "invalid" });
          return;
        }
        await clearPendingMazerOAuthAuthorization();
        navigateToMazer(destination);
        return;
      }
      if (
        result.details.userId !== session.userId ||
        !isExpectedMazerOAuthAuthorization(result.details, window.location.origin)
      ) {
        if (active) setState({ kind: "invalid" });
        return;
      }
      if (active) {
        setState({
          kind: "consent",
          authGeneration,
          details: result.details,
        });
      }
    }

    void start().catch(() => {
      if (active) setState({ kind: "unavailable" });
    });
    return () => {
      active = false;
    };
  }, [resolution]);

  async function decide(decision: "approve" | "deny") {
    if (state.kind !== "consent" || resolution?.status !== "ready" || busy) return;
    setBusy(true);
    try {
      if (resolution.adapter.getAuthGeneration() !== state.authGeneration) {
        await clearPendingMazerOAuthAuthorization();
        setState({ kind: "invalid" });
        return;
      }
      const session = await resolution.adapter.getSession();
      if (
        !session ||
        session.userId !== state.details.userId ||
        resolution.adapter.getAuthGeneration() !== state.authGeneration
      ) {
        await clearPendingMazerOAuthAuthorization();
        setState({ kind: "invalid" });
        return;
      }

      const accessToken = await resolution.adapter.getOAuthAccessToken(session.userId);
      if (resolution.adapter.getAuthGeneration() !== state.authGeneration) {
        await clearPendingMazerOAuthAuthorization();
        setState({ kind: "invalid" });
        return;
      }
      // The server uses this exact captured token for the provider decision.
      // A later SDK/session mutation cannot substitute a newer session.
      const rawRedirect = await decidePendingMazerOAuthAuthorization(
        decision,
        accessToken,
        state.authGeneration,
      );
      const destination = decision === "approve"
        ? sanitizeMazerOAuthApprovalRedirect(rawRedirect)
        : sanitizeMazerOAuthDenialRedirect(rawRedirect);
      if (!destination) {
        setState({ kind: "invalid" });
        return;
      }
      navigateToMazer(destination);
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
      <div className="account-auth-secondary" data-has-legal="true">
        <div className="account-card__links">
          <button className="account-inline-link" disabled={busy} onClick={() => void decide("deny")} type="button">
            Cancel
          </button>
        </div>
        <AccountLegalLinks context={accountExperienceContexts.mazer} />
      </div>
      <div className="account-auth-dock">
        <button className="catalog-button catalog-button--primary" disabled={busy} onClick={() => void decide("approve")} type="button">
          {busy ? "Working…" : "Continue to Mazer"}
        </button>
      </div>
    </section>
  );
}
