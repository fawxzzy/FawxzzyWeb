"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  accountContract,
  accountExperienceContexts,
  classifyRuntimeOrigin,
} from "@/config/account";
import { resolvePortalAuthAdapter } from "@/lib/auth/browser-adapter";
import { loaderHoldRemainingMs } from "@/lib/auth/mazer-loader-timing";
import { MAZER_LOADER_ICON_DATA_URI } from "@/components/account/mazer-loader-icon";
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
  shouldAutoApproveMazerOAuth,
  storePendingMazerOAuthAuthorization,
  type MazerOAuthAuthorizationDetails,
} from "@/lib/auth/mazer-oauth";
import { AUTH_COPY } from "@/lib/auth/copy-matrix";
import {
  authAccentStyle,
  AuthDock,
  AuthHead,
  AuthLegal,
  AuthLinks,
  AuthStatus,
} from "@/components/account/auth-surface";

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

// Keeps the loader up for Mazer's minimum hold before the page leaves, measured from its first paint.
// If the wait ended before the icon would have appeared, it returns at once (bare dark page only).
async function holdLoader() {
  const painted = performance.getEntriesByName("first-paint")[0]?.startTime ?? 0;
  const remaining = loaderHoldRemainingMs(performance.now() - painted);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
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
        await holdLoader();
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
        await holdLoader();
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
      // First-party Mazer (exact client id + exact redirect URI allowlist) is
      // approved without a consent card. The local-test `oauth_consent` flag
      // exists only so the retained consent card stays testable.
      const forceConsent = classifyRuntimeOrigin(window.location.origin) === "local-test" &&
        query.get("oauth_consent") === "1";
      if (
        !forceConsent &&
        shouldAutoApproveMazerOAuth(result.details, window.location.origin, session.userId)
      ) {
        try {
          const rawRedirect = await decidePendingMazerOAuthAuthorization(
            "approve",
            accessToken,
            authGeneration,
          );
          const destination = sanitizeMazerOAuthApprovalRedirect(rawRedirect);
          if (!destination) {
            await clearPendingMazerOAuthAuthorization().catch(() => undefined);
            if (active) setState({ kind: "invalid" });
            return;
          }
          await holdLoader();
          navigateToMazer(destination);
        } catch {
          // No retry and no consent card: the gateway already clears the
          // carrier after a failed decision; show the existing error state.
          await clearPendingMazerOAuthAuthorization().catch(() => undefined);
          if (active) setState({ kind: "unavailable" });
        }
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
    // Mazer's loader, not a card: opaque #02080f from the first paint, the Mazer icon with its soft
    // ring fading in after 150 ms, no text, no scroll. The only text is for screen readers. The icon
    // is an inline data URI so nothing is requested and nothing pops in.
    return (
      <div aria-busy="true" className="oauth-bare" role="status">
        <span className="sr-only">Checking your sign-in.</span>
        <div aria-hidden="true" className="oauth-bare__stage">
          <span className="oauth-bare__ring" />
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI, sized up front */}
          <img alt="" className="oauth-bare__icon" decoding="sync" height={256} src={MAZER_LOADER_ICON_DATA_URI} width={256} />
        </div>
      </div>
    );
  }
  const mazer = accountExperienceContexts.mazer;
  if (state.kind === "invalid" || state.kind === "unavailable") {
    // One way out for every stopped request: start again from Mazer.
    return (
      <AuthStatus
        context={mazer}
        dock={<AuthDock href={accountContract.productOrigins.mazer}>{AUTH_COPY.button.open("Mazer")}</AuthDock>}
        lead={AUTH_COPY.lead.startAgainIn("Mazer")}
        state={state.kind}
        surface="oauth"
        title={AUTH_COPY.title.signInLinkExpired}
      />
    );
  }

  // Retained consent card (only reachable for a non-first-party request or the local-test
  // `oauth_consent` flag). Its title and lead are outside the copy matrix on purpose: consent is
  // owned by a later lane.
  return (
    <section
      aria-labelledby="mazer-oauth-title"
      className="auth-surface"
      data-auth-product="mazer"
      data-auth-surface="oauth-consent"
      style={authAccentStyle(mazer)}
    >
      <AuthHead
        context={mazer}
        lead="Mazer will use your Fawxzzy email to open the same account."
        title="Continue to Mazer?"
        titleId="mazer-oauth-title"
      />
      <div className="auth-body" />
      <AuthLinks>
        <button disabled={busy} onClick={() => void decide("deny")} type="button">
          {AUTH_COPY.link.cancel}
        </button>
      </AuthLinks>
      <AuthLegal context={mazer} />
      <AuthDock busy={busy} onClick={() => void decide("approve")}>
        {busy ? AUTH_COPY.working.opening("Mazer") : "Continue to Mazer"}
      </AuthDock>
    </section>
  );
}
