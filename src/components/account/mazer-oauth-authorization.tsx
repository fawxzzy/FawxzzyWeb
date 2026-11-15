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
  mazerSignInNoticeUrl,
  readPendingMazerOAuthAuthorization,
  rebindPendingMazerOAuthAuthorization,
  sanitizeMazerOAuthApprovalRedirect,
  sanitizeMazerOAuthDenialRedirect,
  shouldAutoApproveMazerOAuth,
  storePendingMazerOAuthAuthorization,
  type MazerOAuthAuthorizationDetails,
  type MazerSignInNotice,
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
  // The request or the provider pointed somewhere other than Mazer's exact registered client and
  // redirect: nothing is followed and the portal shows its own fallback screen.
  | { kind: "unsafe" };

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

// A stopped request (invalid, expired, another session, or the account service failing) goes back
// to Mazer's own sign-in with the reason, never to a portal dead end. The destination is the
// constant registered Mazer origin plus one closed notice key: nothing from the request is followed.
async function returnToMazerSignIn(notice: MazerSignInNotice) {
  await clearPendingMazerOAuthAuthorization().catch(() => undefined);
  await holdLoader();
  navigateToMazer(mazerSignInNoticeUrl(notice));
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

    // Fail-closed exits. `expired` / `unavailable` go back to Mazer's sign-in with that notice;
    // `unsafe` (a client, redirect or provider answer that is not Mazer's exact registration)
    // stays on the portal fallback screen and follows nothing.
    const stop = async (reason: MazerSignInNotice | "unsafe") => {
      if (reason === "unsafe") {
        await clearPendingMazerOAuthAuthorization().catch(() => undefined);
        if (active) setState({ kind: "unsafe" });
        return;
      }
      await returnToMazerSignIn(reason);
    };

    async function start() {
      if (resolution?.status !== "ready") {
        await stop("unavailable");
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
          await stop("expired");
          return;
        }
        const stored = await storePendingMazerOAuthAuthorization(
          incomingAuthorizationId,
          authGeneration,
        );
        if (!stored) {
          await stop("unavailable");
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
        await stop("unavailable");
        return;
      }

      // Device-level auto sign-in: a portal session that already exists (from any app on this
      // device) skips sign-in, and the first-party check below approves without a card.
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
        await stop("expired");
        return;
      }

      const accessToken = await resolution.adapter.getOAuthAccessToken(session.userId);
      if (
        resolution.adapter.getAuthGeneration() !== authGeneration ||
        (await resolution.adapter.getSession())?.userId !== session.userId
      ) {
        await stop("expired");
        return;
      }

      const result = await readPendingMazerOAuthAuthorization(accessToken, authGeneration);
      if (!result) {
        await stop("expired");
        return;
      }
      if (result.kind === "redirect") {
        const destination = sanitizeMazerOAuthApprovalRedirect(result.redirectUrl);
        if (!destination) {
          await stop("unsafe");
          return;
        }
        await clearPendingMazerOAuthAuthorization();
        await holdLoader();
        navigateToMazer(destination);
        return;
      }
      if (result.details.userId !== session.userId) {
        // Started under another account on this device: start again from Mazer.
        await stop("expired");
        return;
      }
      if (!isExpectedMazerOAuthAuthorization(result.details, window.location.origin)) {
        // Not Mazer's exact client, redirect URI and scope: no consent card, no approval, and no
        // redirect to anything the request named. There is no third-party consent path.
        await stop("unsafe");
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
        let rawRedirect: string;
        try {
          rawRedirect = await decidePendingMazerOAuthAuthorization(
            "approve",
            accessToken,
            authGeneration,
          );
        } catch {
          // No retry and no consent card: the gateway already clears the carrier after a failed
          // decision; the player goes back to Mazer's sign-in once.
          await stop("unavailable");
          return;
        }
        const destination = sanitizeMazerOAuthApprovalRedirect(rawRedirect);
        if (!destination) {
          await stop("unsafe");
          return;
        }
        await holdLoader();
        navigateToMazer(destination);
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

    void start().catch(() => stop("unavailable"));
    return () => {
      active = false;
    };
  }, [resolution]);

  async function decide(decision: "approve" | "deny") {
    if (state.kind !== "consent" || resolution?.status !== "ready" || busy) return;
    setBusy(true);
    // Same exits as the automatic path: back to Mazer's sign-in with a reason, or the fallback
    // screen when the provider answer is not Mazer's exact redirect.
    const backToMazer = async (notice: MazerSignInNotice) => {
      setState({ kind: "loading" });
      await returnToMazerSignIn(notice);
    };
    try {
      if (resolution.adapter.getAuthGeneration() !== state.authGeneration) {
        await backToMazer("expired");
        return;
      }
      const session = await resolution.adapter.getSession();
      if (
        !session ||
        session.userId !== state.details.userId ||
        resolution.adapter.getAuthGeneration() !== state.authGeneration
      ) {
        await backToMazer("expired");
        return;
      }

      const accessToken = await resolution.adapter.getOAuthAccessToken(session.userId);
      if (resolution.adapter.getAuthGeneration() !== state.authGeneration) {
        await backToMazer("expired");
        return;
      }
      // The server uses this exact captured token for the provider decision.
      // A later SDK/session mutation cannot substitute a newer session.
      let rawRedirect: string;
      try {
        rawRedirect = await decidePendingMazerOAuthAuthorization(
          decision,
          accessToken,
          state.authGeneration,
        );
      } catch {
        await backToMazer("unavailable");
        return;
      }
      const destination = decision === "approve"
        ? sanitizeMazerOAuthApprovalRedirect(rawRedirect)
        : sanitizeMazerOAuthDenialRedirect(rawRedirect);
      if (!destination) {
        await clearPendingMazerOAuthAuthorization().catch(() => undefined);
        setState({ kind: "unsafe" });
        return;
      }
      navigateToMazer(destination);
    } catch {
      await backToMazer("unavailable");
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
  if (state.kind === "unsafe") {
    // The only portal fallback: the request or the provider named a destination that is not
    // Mazer's exact registration, so nothing is followed. The dock is the constant Mazer origin.
    return (
      <AuthStatus
        context={mazer}
        dock={<AuthDock href={accountContract.productOrigins.mazer}>{AUTH_COPY.button.open("Mazer")}</AuthDock>}
        lead={AUTH_COPY.lead.startAgainIn("Mazer")}
        state="unsafe"
        surface="oauth"
        title={AUTH_COPY.title.signInLinkExpired}
      />
    );
  }

  // Retained consent card, reachable only through the local-test `oauth_consent` flag: in production
  // a request that passes the Mazer identity check is auto-approved and anything else is `unsafe`.
  // Its title and lead are outside the copy matrix on purpose: consent is owned by a later lane.
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
