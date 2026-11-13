"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  accountContract,
  classifyRuntimeOrigin,
  resolveAccountAuthIntent,
  resolveAccountExperienceContext,
  type AccountAuthIntent,
  type AccountExperienceContext,
} from "@/config/account";
import {
  sanitizeContextReturnTarget,
  sanitizePostAuthReturnTarget,
  sanitizeReturnTarget,
} from "@/config/account-return";
import { productIdentity } from "@/config/product";
import {
  callbackReceiptKey,
  callbackStateMatches,
  confirmationStateMatches,
  parseCallbackPayload,
  parseConfirmPayload,
  parseRecoveryPayload,
  sanitizeAuthUrl,
  sanitizeRecoveryUrl,
} from "@/lib/auth/callback-contract";
import {
  createRevalidationGate,
  scheduleCooldownTicks,
  scheduleDeferredAttempt,
  type OneShotAttemptState,
} from "@/lib/auth/client-lifecycle";
import {
  isUsernameTakenError,
  safeAuthError,
  safeAuthSuccess,
  UsernameSignInThrottledError,
  USERNAME_TAKEN_MESSAGE,
} from "@/lib/auth/errors";
import {
  resolvePortalAuthAdapter,
  type AdapterResolution,
  type PortalAuthAdapter,
  type PortalSession,
} from "@/lib/auth/browser-adapter";
import { PASSWORD_MINIMUM } from "@/lib/auth/password-policy";
import {
  guidanceForCredentials,
  guidanceForNewPassword,
  guidanceForResetRequest,
  USERNAME_VISIBILITY_NOTE,
  type GuidanceProblem,
} from "@/lib/auth/form-guidance";
import { FitnessHandoffError } from "@/lib/auth/fitness-handoff";
import {
  SystemState,
  type SystemStateVariant,
} from "@/components/system/system-state";
import {
  AccountLegalLinks,
  AccountTextDivider,
} from "@/components/account/account-legal-links";

type PortalMode = "login" | "account" | "confirm" | "callback" | "reset";

type Notice = {
  kind: "error" | "info" | "success";
  text: string;
  /** Rendered beside the form it concerns instead of as the submit button label. */
  inline?: boolean;
  variant?: SystemStateVariant;
};

const emptySubscribe = () => () => undefined;
const SIGNUP_SETTLEMENT_MINIMUM_MS = 500;
const SIGNUP_FAILURE_VISIBLE_MS = 8_000;
const THROTTLED_NOTICE_VISIBLE_MS = 8_000;
const GUIDANCE_ID = "account-auth-guidance";
const USERNAME_NOTE_ID = "account-username-note";
const USERNAME_ERROR_ID = "account-username-error";

async function settleSignupAttempt(
  adapter: PortalAuthAdapter,
  email: string,
  password: string,
  username: string,
  context: AccountExperienceContext,
  returnTarget?: string,
) {
  const [result] = await Promise.allSettled([
    adapter.signUp(email, password, username, context.id, returnTarget),
    new Promise((resolve) => window.setTimeout(resolve, SIGNUP_SETTLEMENT_MINIMUM_MS)),
  ]);
  // A rejection keeps its error so the caller can tell a taken username (public, safe to name)
  // from every other failure (shown as one neutral sentence).
  return result.status === "fulfilled"
    ? { session: result.value, error: null }
    : { session: null, error: result.reason as unknown };
}

/**
 * Where a signed-in session continues for the generic (non-Fitness-handoff) contexts. Shared by
 * sign-in and sign-up so a session never lands on a dead-end notice.
 */
function resolvePostAuthTarget(context: AccountExperienceContext) {
  const postAuthTarget = sanitizePostAuthReturnTarget(
    new URLSearchParams(window.location.search).get("returnTo"),
    context,
  );
  if (postAuthTarget.startsWith("/")) return postAuthTarget;
  const destinationUrl = new URL(postAuthTarget);
  if (context.id === "website") destinationUrl.searchParams.set("signedIn", "1");
  return destinationUrl.href;
}

function deriveIdentity(identifier: string) {
  const normalized = identifier.trim();
  return normalized.includes("@") ? normalized.split("@", 1)[0] : normalized;
}

function readRememberedIdentity() {
  try {
    const value = window.localStorage.getItem(accountContract.rememberedIdentityKey)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeRememberedIdentity(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return;
  try {
    window.localStorage.setItem(accountContract.rememberedIdentityKey, normalized);
  } catch {
    // Remembering a display label is optional; authentication must still proceed.
  }
}

function useHydrated() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function useAdapterResolution() {
  const hydrated = useHydrated();
  return useMemo<AdapterResolution | null>(() => {
    if (!hydrated) return null;
    return resolvePortalAuthAdapter(window.location);
  }, [hydrated]);
}

function useAccountExperienceContext() {
  const hydrated = useHydrated();
  return useMemo(() => {
    if (!hydrated) return resolveAccountExperienceContext("website");
    const query = new URLSearchParams(window.location.search);
    const contexts = query.getAll("app");
    return resolveAccountExperienceContext(contexts.length === 1 ? contexts[0] : null);
  }, [hydrated]);
}

function useCooldown(defaultSeconds = 5) {
  const [until, setUntil] = useState(0);
  const [clock, setClock] = useState(0);
  const remaining = Math.max(0, Math.ceil((until - clock) / 1000));

  useEffect(() => {
    if (!until) return;
    return scheduleCooldownTicks(until, (nextClock, expired) => {
      setClock(nextClock);
      if (expired) setUntil(0);
    });
  }, [until]);

  return {
    remaining,
    start(seconds = defaultSeconds) {
      const next = Date.now() + seconds * 1000;
      setUntil(next);
      setClock(Date.now());
    },
  };
}

function useTransientNotice(duration = 5_000) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return {
    clear() {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setNotice(null);
    },
    notice,
    show(nextNotice: Notice, visibleMs = duration) {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      setNotice(nextNotice);
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setNotice(null);
      }, visibleMs);
    },
  };
}

function contextualPath(
  path: string,
  context: AccountExperienceContext,
  returnTarget?: string,
) {
  if (context.id === "website") return path;
  const url = new URL(path, accountContract.canonicalOrigin);
  url.searchParams.set("app", context.id);
  if (context.id === "mazer" && returnTarget === "/oauth/authorize") {
    url.searchParams.set("returnTo", returnTarget);
  }
  return `${url.pathname}${url.search}`;
}

function isFitnessReturnTarget(target: string) {
  try {
    return new URL(sanitizeReturnTarget(target)).origin ===
      new URL(accountContract.productOrigins.fitness).origin;
  } catch {
    return false;
  }
}

async function completeAuthenticatedReturn(
  adapter: PortalAuthAdapter,
  target: string,
  session: PortalSession | null,
) {
  if (!isFitnessReturnTarget(target)) return sanitizeReturnTarget(target);
  if (!session) throw new FitnessHandoffError();
  return adapter.handoffToFitness(target, session.userId);
}

function AuthLiveNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      className="account-auth-live-notice"
      data-notice-kind={notice.kind}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

/**
 * Visible "what is needed" banner for input problems. Lines disappear as each field is
 * fixed (it only lists problems whose field is still flagged invalid). The red field
 * border alone never carries the meaning.
 */
function GuidanceBanner({
  problems,
  invalidFields,
}: {
  problems: GuidanceProblem[];
  invalidFields: Set<string>;
}) {
  const visible = problems.filter((problem) => invalidFields.has(problem.field));
  if (visible.length === 0) return null;
  return (
    <div className="account-auth-guidance" data-auth-guidance id={GUIDANCE_ID} role="alert">
      <p className="account-auth-guidance__title">
        {visible.length === 1 ? "One thing to fix" : `${visible.length} things to fix`}
      </p>
      <ul>
        {visible.map((problem) => (
          <li data-field={problem.field} key={problem.field}>{problem.message}</li>
        ))}
      </ul>
    </div>
  );
}

function focusFirstProblem(form: HTMLFormElement, problems: GuidanceProblem[]) {
  const first = problems[0];
  if (!first) return;
  const element = form.elements.namedItem(first.field);
  if (element instanceof HTMLElement) element.focus();
}

function SetupState({ resolution }: { resolution: AdapterResolution | null }) {
  if (!resolution) {
    return <p className="account-capability-note" role="status">Preparing account service.</p>;
  }
  if (resolution.status === "ready") return null;

  return <p className="account-capability-note" role="status">Account service unavailable.</p>;
}

function RuntimeNote() {
  const hydrated = useHydrated();
  if (!hydrated) return null;

  const kind = classifyRuntimeOrigin(window.location.origin);
  if (kind === "account" || kind === "hub") return null;

  return (
    <p className="account-runtime-note" data-runtime-origin={kind}>
      {kind === "local-test"
        ? "Local verification surface"
        : kind === "preview"
          ? "Non-production Preview — account.fawxzzy.com is not attached"
          : "The canonical account origin is account.fawxzzy.com"}
    </p>
  );
}

function noticeVariant(notice: Notice): SystemStateVariant {
  return (
    notice.variant ??
    (notice.kind === "success"
      ? "success"
      : notice.kind === "error"
        ? "recoverable-error"
        : "pending")
  );
}

function noticeTitle(variant: SystemStateVariant) {
  switch (variant) {
    case "success":
      return "Done.";
    case "invalid":
      return "Invalid request.";
    case "expired":
      return "Request expired.";
    case "unauthorized":
      return "Not allowed.";
    case "unavailable":
      return "Service unavailable.";
    case "terminal-error":
      return "Cannot continue.";
    case "recoverable-error":
      return "Something went wrong.";
    default:
      return "Working…";
  }
}

function StatusNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const variant = noticeVariant(notice);

  return (
    <SystemState
      className={`account-notice account-notice--${notice.kind}`}
      compact
      description={notice.text}
      framed={false}
      title={noticeTitle(variant)}
      variant={variant}
    />
  );
}

function adapterFrom(resolution: AdapterResolution | null): PortalAuthAdapter | null {
  return resolution?.status === "ready" ? resolution.adapter : null;
}

function PasswordEye({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M2 12c2.5-4 5.8-6 10-6s7.5 2 10 6c-2.5 4-5.8 6-10 6s-7.5-2-10-6Z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? null : <path d="M4 4l16 16" />}
    </svg>
  );
}

function LoginPanel({
  context,
  resolution,
}: {
  context: AccountExperienceContext;
  resolution: AdapterResolution | null;
}) {
  const hydrated = useHydrated();
  // `?intent=signup` picks the form the screen opens on. Once the person flips the toggle their
  // choice wins for the rest of the visit (it is never re-derived from the address).
  const requestedIntent: AccountAuthIntent = hydrated
    ? resolveAccountAuthIntent(new URLSearchParams(window.location.search).getAll("intent"))
    : "login";
  const [chosenIntent, setChosenIntent] = useState<AccountAuthIntent | null>(null);
  const intent = chosenIntent ?? requestedIntent;
  const [username, setUsername] = useState("");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
  const [guidance, setGuidance] = useState<GuidanceProblem[]>([]);
  const [usernameTaken, setUsernameTaken] = useState(false);
  const transient = useTransientNotice();
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [rememberedIdentity, setRememberedIdentity] = useState<string | null>(null);
  const storedRememberedIdentity = useSyncExternalStore(
    emptySubscribe,
    readRememberedIdentity,
    () => null,
  );
  const cooldown = useCooldown();
  const adapter = adapterFrom(resolution);
  const displayedIdentity = rememberedIdentity ?? storedRememberedIdentity;
  const returnTarget = hydrated
    ? sanitizePostAuthReturnTarget(
        new URLSearchParams(window.location.search).get("returnTo"),
        context,
      )
    : null;
  const internalMazerReturn = returnTarget === "/oauth/authorize"
    ? returnTarget
    : undefined;

  useEffect(() => {
    if (!adapter || displayedIdentity) return;
    let active = true;
    adapter
      .getSession()
      .then((session) => {
        if (!active || !session) return;
        const identity = session.displayName || deriveIdentity(session.email ?? "");
        if (!identity) return;
        writeRememberedIdentity(identity);
        setRememberedIdentity(identity);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [adapter, displayedIdentity]);

  function switchIntent(event: React.MouseEvent<HTMLButtonElement>) {
    event.currentTarget.blur();
    setChosenIntent(intent === "login" ? "signup" : "login");
    transient.clear();
    setInvalidFields(new Set());
    setUsernameTaken(false);
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || cooldown.remaining) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const submittedUsername = String(form.get("username") ?? "").trim();
    const problems = guidanceForCredentials({ intent, email, password, username: submittedUsername });
    if (problems.length > 0) {
      setGuidance(problems);
      setInvalidFields(new Set(problems.map((problem) => problem.field)));
      focusFirstProblem(event.currentTarget, problems);
      return;
    }

    setBusy(true);
    transient.clear();
    setInvalidFields(new Set());
    setUsernameTaken(false);
    cooldown.start();
    try {
      if (intent === "signup") {
        // The adapter persists and publishes a real returned session. A session means the account
        // exists and the user is signed in, so continue exactly like sign-in. No session means the
        // provider did not complete the request for some reason we deliberately do not reveal.
        const { session, error: signupError } = await settleSignupAttempt(
          adapter,
          email,
          password,
          submittedUsername,
          context,
          internalMazerReturn,
        );
        if (!session && isUsernameTakenError(signupError)) {
          // A username is public (it shows on the leaderboard), so this one rejection is named,
          // beside the field. Email-duplicate and every other failure keep the neutral notice.
          setUsernameTaken(true);
          setInvalidFields(new Set(["username"]));
          const usernameField = formElement.elements.namedItem("username");
          if (usernameField instanceof HTMLElement) usernameField.focus();
          return;
        }
        if (!session) {
          cooldown.start(SIGNUP_FAILURE_VISIBLE_MS / 1000);
          transient.show(
            { kind: "info", text: safeAuthError("signup"), inline: true },
            SIGNUP_FAILURE_VISIBLE_MS,
          );
          return;
        }
        const identity = session.displayName || submittedUsername;
        writeRememberedIdentity(identity);
        setRememberedIdentity(identity);
        const destination = context.id === "fitness"
          ? await adapter.handoffToFitness(
              sanitizeContextReturnTarget(
                new URLSearchParams(window.location.search).get("returnTo"),
                context,
              ),
              session.userId,
            )
          : internalMazerReturn ?? resolvePostAuthTarget(context);
        transient.show({ kind: "success", text: safeAuthSuccess("signup") });
        if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
          document.documentElement.dataset.postAuthDestination = destination;
        } else {
          window.location.assign(destination);
        }
        return;
      }

      const session = await adapter.signIn(email, password);
      if (session) {
        const identity = session.displayName || deriveIdentity(email);
        writeRememberedIdentity(identity);
        setRememberedIdentity(identity);
      }
      if (!session) transient.show({ kind: "error", text: safeAuthError("login") });
      if (session) {
        const postAuthTarget = resolvePostAuthTarget(context);
        const destination = context.id === "fitness" && !postAuthTarget.startsWith("/")
          ? await adapter.handoffToFitness(postAuthTarget, session.userId)
          : postAuthTarget;
        transient.show({ kind: "success", text: safeAuthSuccess("login") });
        if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
          document.documentElement.dataset.postAuthDestination = destination;
        } else {
          window.location.assign(destination);
        }
      }
    } catch (error) {
      if (error instanceof UsernameSignInThrottledError) {
        cooldown.start(THROTTLED_NOTICE_VISIBLE_MS / 1000);
      }
      transient.show({
        kind: "error",
        text: error instanceof FitnessHandoffError
          ? error.message
          : error instanceof UsernameSignInThrottledError
            ? safeAuthError("login-throttled")
            : safeAuthError(intent),
      }, error instanceof UsernameSignInThrottledError ? THROTTLED_NOTICE_VISIBLE_MS : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="login-panel-title"
      className="account-card account-card--auth"
      data-auth-product={context.id}
      data-auth-surface="credentials"
      style={{ "--auth-accent": context.accentRgb } as React.CSSProperties}
    >
      <RuntimeNote />
      <header className="account-auth-intro">
        <p>{context.productName}</p>
        <h1 aria-live="polite" id="login-panel-title">
          {intent === "login" ? "Welcome" : "Create Account"}
        </h1>
        {intent === "login" && displayedIdentity ? (
          <p className="account-auth-identity" data-testid="remembered-identity">
            {displayedIdentity}
          </p>
        ) : null}
      </header>
      <div className="account-auth-body">
        <SetupState resolution={resolution} />
        <AuthLiveNotice notice={transient.notice} />
        <GuidanceBanner invalidFields={invalidFields} problems={guidance} />
        <form className="account-form account-form--auth" id="account-auth-form" noValidate onSubmit={submit}>
        {intent === "signup" ? (
          <fieldset data-invalid={invalidFields.has("username") || undefined}>
            <legend><label htmlFor="account-username">Username</label></legend>
            <input
              aria-describedby={[
                usernameTaken ? USERNAME_ERROR_ID : null,
                USERNAME_NOTE_ID,
                invalidFields.has("username") && !usernameTaken ? GUIDANCE_ID : null,
              ].filter(Boolean).join(" ")}
              aria-invalid={invalidFields.has("username") || undefined}
              id="account-username"
              autoComplete="username"
              maxLength={15}
              minLength={2}
              name="username"
              onChange={(event) => {
                setUsername(event.target.value);
                setUsernameTaken(false);
                setInvalidFields((current) => {
                  const next = new Set(current);
                  next.delete("username");
                  return next;
                });
              }}
              pattern="[A-Za-z0-9._-]{2,15}"
              required
              type="text"
              value={username}
            />
          </fieldset>
        ) : null}
        {intent === "signup" ? (
          <p className="account-field-note" id={USERNAME_NOTE_ID}>
            {USERNAME_VISIBILITY_NOTE}
          </p>
        ) : null}
        {intent === "signup" && usernameTaken ? (
          <p className="account-field-error" data-username-taken id={USERNAME_ERROR_ID} role="alert">
            {USERNAME_TAKEN_MESSAGE}
          </p>
        ) : null}
        <fieldset data-invalid={invalidFields.has("email") || undefined}>
          <legend><label htmlFor="account-email">{intent === "login" ? "Email or username" : "Email"}</label></legend>
          <input
            aria-describedby={invalidFields.has("email") ? GUIDANCE_ID : undefined}
            aria-invalid={invalidFields.has("email") || undefined}
            id="account-email"
            autoComplete={intent === "login" ? "username" : "email"}
            inputMode={intent === "login" ? "text" : "email"}
            name="email"
            onChange={() => setInvalidFields((current) => {
              const next = new Set(current);
              next.delete("email");
              return next;
            })}
            required
            type={intent === "login" ? "text" : "email"}
          />
        </fieldset>
        <fieldset data-invalid={invalidFields.has("password") || undefined}>
          <legend><label htmlFor="account-password">Password</label></legend>
          <input
            aria-describedby={invalidFields.has("password") ? GUIDANCE_ID : undefined}
            aria-invalid={invalidFields.has("password") || undefined}
            id="account-password"
            autoComplete={intent === "login" ? "current-password" : "new-password"}
            minLength={intent === "signup" ? PASSWORD_MINIMUM : undefined}
            name="password"
            onChange={() => setInvalidFields((current) => {
              const next = new Set(current);
              next.delete("password");
              return next;
            })}
            required
            type={passwordVisible ? "text" : "password"}
          />
          <button
            aria-label={passwordVisible ? "Hide password" : "Show password"}
            className="account-password-toggle"
            onClick={() => setPasswordVisible((visible) => !visible)}
            type="button"
          >
            <PasswordEye visible={passwordVisible} />
          </button>
        </fieldset>
        {transient.notice?.inline ? (
          // The sr-only live notice above already announces this text; keep the visible copy quiet.
          <p aria-hidden="true" className="account-form-result" data-notice-kind={transient.notice.kind}>
            {transient.notice.text}
          </p>
        ) : null}
        </form>
      </div>
      <div
        className="account-auth-secondary"
        data-has-legal={context.legalLinks.length > 0 || undefined}
      >
        <div className="account-card__links">
          <button
            className="account-text-action"
            onClick={switchIntent}
            type="button"
          >
            {intent === "login" ? "Create Account" : "Log in"}
          </button>
          {intent === "login" ? (
            <>
              <AccountTextDivider />
              <a href={contextualPath("/reset-password", context, internalMazerReturn)}>Reset Password</a>
            </>
          ) : null}
        </div>
        <AccountLegalLinks context={context} />
      </div>
      <div className="account-auth-dock">
        <button
          className="catalog-button catalog-button--primary"
          disabled={!adapter || busy || cooldown.remaining > 0}
          form="account-auth-form"
          type="submit"
        >
          {busy
            ? "Working…"
            : transient.notice && !transient.notice.inline
              ? transient.notice.text
              : intent === "login"
                ? context.signInLabel
                : context.signUpLabel}
        </button>
      </div>
    </section>
  );
}

function usePortalSession(adapter: PortalAuthAdapter | null) {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!adapter) return;
    let active = true;
    const gate = createRevalidationGate();
    // Counts the sign-outs the provider announces. A check that started before one describes a
    // session that no longer exists and must not bring it back. Other events (the SDK re-announces
    // the session on tab return and after a refresh) do not make a check stale.
    let signOuts = 0;
    const unsubscribe = adapter.onSessionChange((next) => {
      if (next === null) signOuts += 1;
      if (active) setSession(next);
    });
    // The cached session can outlive the provider's: signing out everywhere in Fitness or Mazer ends
    // it at the provider while this origin's storage still holds a copy. Ask the provider after load
    // and whenever the person comes back to the page (at most once per interval); a null answer is a
    // sign-out, and a check that fails changes nothing (being offline is not a sign-out).
    const revalidate = () => {
      if (!gate.begin()) return;
      const startedAt = signOuts;
      adapter
        .validateSession()
        .then((next) => {
          if (active && (next === null || signOuts === startedAt)) setSession(next);
        })
        .catch(() => undefined)
        .finally(gate.end);
    };
    const revalidateWhenVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    const revalidateWhenRestored = (event: PageTransitionEvent) => {
      if (event.persisted) revalidate();
    };
    document.addEventListener("visibilitychange", revalidateWhenVisible);
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidateWhenRestored);
    adapter
      .getSession()
      .then((next) => {
        if (!active) return;
        setSession(next);
        if (next) revalidate();
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", revalidateWhenVisible);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidateWhenRestored);
    };
  }, [adapter]);

  return { error, loaded, session, setSession };
}

function AccountPanel({
  context,
  resolution,
}: {
  context: AccountExperienceContext;
  resolution: AdapterResolution | null;
}) {
  const adapter = adapterFrom(resolution);
  const { error, loaded, session } = usePortalSession(adapter);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  // True from the moment this page asks to sign out until it has chosen its own destination. The
  // provider announces SIGNED_OUT before adapter.signOut() resolves, so without this the
  // "session lost" redirect below would send the person to /login ahead of the product origin.
  const signingOutRef = useRef(false);

  useEffect(() => {
    if (adapter && loaded && !session && !error && !signingOutRef.current) {
      if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
        document.documentElement.dataset.sessionLostRedirect = "login";
      }
      window.location.replace(contextualPath("/login", context));
    }
  }, [adapter, context, error, loaded, session]);

  async function signOut() {
    if (!adapter || signingOutRef.current) return;
    signingOutRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await adapter.signOut();
      const destination = new URL("/", context.destinationOrigin);
      if (context.id === "website") destination.searchParams.set("signedOut", "1");
      if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
        // Deterministic harness: record the real destination instead of leaving the test origin.
        document.documentElement.dataset.signOutDestination = destination.href;
        return;
      }
      window.location.assign(destination.href);
    } catch {
      signingOutRef.current = false;
      setNotice({ kind: "error", text: safeAuthError("signout") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="account-status-title"
      className="account-card account-card--auth account-card--account"
      data-auth-product={context.id}
      data-auth-surface="account-status"
      style={{ "--auth-accent": context.accentRgb } as React.CSSProperties}
    >
      <RuntimeNote />
      <header className="account-auth-intro">
        <p>{context.productName}</p>
        <h1 id="account-status-title">Account</h1>
      </header>
      <SetupState resolution={resolution} />
      {error ? <StatusNotice notice={{ kind: "error", text: safeAuthError("session") }} /> : null}
      <StatusNotice notice={notice} />
      <div className="account-auth-body">
        {adapter && loaded && session ? (
          <div className="account-form account-form--auth account-account-fields">
            <fieldset>
              <legend><label htmlFor="account-current-username">Username</label></legend>
              <input
                id="account-current-username"
                name="username"
                readOnly
                type="text"
                value={session.displayName ?? deriveIdentity(session.email ?? "Account")}
              />
            </fieldset>
            <fieldset>
              <legend><label htmlFor="account-current-email">Email</label></legend>
              <input
                id="account-current-email"
                name="email"
                readOnly
                type="email"
                value={session.email ?? "Email unavailable"}
              />
            </fieldset>
          </div>
        ) : null}
      </div>
      <div
        className="account-auth-secondary"
        data-has-legal={context.legalLinks.length > 0 || undefined}
      >
        <div className="account-card__links">
          <a href={contextualPath("/reset-password", context)}>Reset Password</a>
        </div>
        <AccountLegalLinks context={context} />
      </div>
      <div className={`account-auth-dock${session ? " account-auth-dock--danger" : ""}`}>
        {resolution && !adapter ? (
          <button className="catalog-button catalog-button--primary" disabled type="button">
            Unavailable
          </button>
        ) : session ? (
          <button
            className="catalog-button catalog-button--primary"
            disabled={busy}
            onClick={signOut}
            type="button"
          >
            {busy ? "Working…" : "Sign out"}
          </button>
        ) : loaded ? (
          <a className="catalog-button catalog-button--primary" href={contextualPath("/login", context)}>
            Sign in
          </a>
        ) : (
          <button className="catalog-button catalog-button--primary" disabled type="button">
            Checking…
          </button>
        )}
      </div>
    </section>
  );
}

type RecoverySessionState =
  | "expired"
  | "idle"
  | "invalid"
  | "pending"
  | "ready"
  | "recoverable-error"
  | "setup-pending";

function useRecoverySession(
  hydrated: boolean,
  recovery: boolean,
  resolution: AdapterResolution | null,
) {
  const processed = useRef(false);
  const [state, setState] = useState<RecoverySessionState>("idle");

  useEffect(() => {
    if (!hydrated || !recovery || !resolution || processed.current) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (processed.current) return;
      processed.current = true;
      const payload = parseRecoveryPayload(new URL(window.location.href));
      sanitizeRecoveryUrl();

      if (!payload) {
        if (active) setState("invalid");
        return;
      }
      if (resolution.status !== "ready") {
        if (active) setState("setup-pending");
        return;
      }

      setState("pending");
      const sessionPromise = payload.code
        ? resolution.adapter.exchangeCode(payload.code)
        : resolution.adapter.getSession();
      sessionPromise
        .then((session) => {
          if (active) setState(session ? "ready" : "expired");
        })
        .catch(() => {
          if (active) setState("recoverable-error");
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [hydrated, recovery, resolution]);

  return state;
}

function ResetPanel({
  context,
  resolution,
}: {
  context: AccountExperienceContext;
  resolution: AdapterResolution | null;
}) {
  const hydrated = useHydrated();
  const recovery = hydrated
    ? new URLSearchParams(window.location.search).get("recovery") === "1"
    : false;
  const adapter = adapterFrom(resolution);
  const transient = useTransientNotice();
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
  const [guidance, setGuidance] = useState<GuidanceProblem[]>([]);
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const cooldown = useCooldown();
  const recoveryState = useRecoverySession(hydrated, recovery, resolution);
  const recoveryReady = recovery && recoveryState === "ready";
  const returnTarget = hydrated
    ? sanitizePostAuthReturnTarget(
        new URLSearchParams(window.location.search).get("returnTo"),
        context,
      )
    : null;
  const internalMazerReturn = returnTarget === "/oauth/authorize"
    ? returnTarget
    : undefined;

  const recoveryNotice: Notice | null = !recovery
    ? null
    : recoveryState === "invalid"
      ? { kind: "error", text: "Recovery link invalid.", variant: "invalid" }
      : recoveryState === "expired"
        ? { kind: "error", text: "Recovery link expired.", variant: "expired" }
        : recoveryState === "recoverable-error"
          ? { kind: "error", text: safeAuthError("reset-complete") }
          : recoveryState === "setup-pending"
            ? { kind: "info", text: "Account service unavailable." }
            : recoveryState === "ready"
              ? null
              : { kind: "info", text: "Preparing recovery…" };
  const actionNotice = transient.notice ?? recoveryNotice;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || cooldown.remaining || (recovery && !recoveryReady)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    if (recovery) {
      const password = String(form.get("password") ?? "");
      const confirmation = String(form.get("confirmation") ?? "");
      const problems = guidanceForNewPassword(password, confirmation);
      if (problems.length > 0) {
        setGuidance(problems);
        setInvalidFields(new Set(problems.map((problem) => problem.field)));
        focusFirstProblem(formElement, problems);
        return;
      }
      setBusy(true);
      transient.clear();
      setInvalidFields(new Set());
      cooldown.start();
      try {
        await adapter.updatePassword(password);
        // Ends only this throw-away recovery session. Signing the person out of the apps they are
        // using is the account page's Sign out, not a side effect of choosing a new password.
        await adapter.signOut("this-session");
        formElement.reset();
        transient.show({ kind: "success", text: safeAuthSuccess("reset-complete") });
        window.setTimeout(() => {
          window.location.replace(contextualPath("/login", context, internalMazerReturn));
        }, 700);
      } catch {
        transient.show({ kind: "error", text: safeAuthError("reset-complete") });
      } finally {
        setBusy(false);
      }
      return;
    }

    const email = String(form.get("email") ?? "").trim();
    const emailProblems = guidanceForResetRequest(email);
    if (emailProblems.length > 0) {
      setGuidance(emailProblems);
      setInvalidFields(new Set(emailProblems.map((problem) => problem.field)));
      focusFirstProblem(formElement, emailProblems);
      return;
    }
    setBusy(true);
    transient.clear();
    setInvalidFields(new Set());
    cooldown.start();
    try {
      await adapter.requestPasswordReset(email, context.id, internalMazerReturn);
      transient.show({ kind: "success", text: safeAuthSuccess("reset-request") });
    } catch {
      transient.show({ kind: "success", text: safeAuthSuccess("reset-request") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Password recovery"
      className="account-card account-card--auth"
      data-auth-product={context.id}
      data-auth-surface="recovery"
      style={{ "--auth-accent": context.accentRgb } as React.CSSProperties}
    >
      <RuntimeNote />
      <header className="account-auth-intro">
        <p>{context.productName}</p>
        <h1 id="reset-panel-title">{recovery ? "New Password" : "Reset Password"}</h1>
      </header>
      <div className="account-auth-body">
        <SetupState resolution={resolution} />
        <AuthLiveNotice notice={actionNotice} />
        <GuidanceBanner invalidFields={invalidFields} problems={guidance} />
        {!recovery || recoveryReady ? (
          <form className="account-form account-form--auth" id="account-reset-form" noValidate onSubmit={submit}>
        {recovery ? (
          <>
            <fieldset data-invalid={invalidFields.has("password") || undefined}>
              <legend><label htmlFor="account-new-password">New password</label></legend>
              <input
                aria-describedby={invalidFields.has("password") ? GUIDANCE_ID : undefined}
                aria-invalid={invalidFields.has("password") || undefined}
                autoComplete="new-password"
                id="account-new-password"
                minLength={PASSWORD_MINIMUM}
                name="password"
                onChange={() => setInvalidFields((current) => {
                  const next = new Set(current);
                  next.delete("password");
                  return next;
                })}
                required
                type={passwordVisible ? "text" : "password"}
              />
              <button aria-label={passwordVisible ? "Hide password" : "Show password"} className="account-password-toggle" onClick={() => setPasswordVisible((visible) => !visible)} type="button">
                <PasswordEye visible={passwordVisible} />
              </button>
            </fieldset>
            <fieldset data-invalid={invalidFields.has("confirmation") || undefined}>
              <legend><label htmlFor="account-confirm-password">Confirm password</label></legend>
              <input
                aria-describedby={invalidFields.has("confirmation") ? GUIDANCE_ID : undefined}
                aria-invalid={invalidFields.has("confirmation") || undefined}
                autoComplete="new-password"
                id="account-confirm-password"
                minLength={PASSWORD_MINIMUM}
                name="confirmation"
                onChange={() => setInvalidFields((current) => {
                  const next = new Set(current);
                  next.delete("confirmation");
                  return next;
                })}
                required
                type={confirmationVisible ? "text" : "password"}
              />
              <button aria-label={confirmationVisible ? "Hide password" : "Show password"} className="account-password-toggle" onClick={() => setConfirmationVisible((visible) => !visible)} type="button">
                <PasswordEye visible={confirmationVisible} />
              </button>
            </fieldset>
          </>
        ) : (
          <fieldset data-invalid={invalidFields.has("email") || undefined}>
            <legend><label htmlFor="account-reset-email">Email</label></legend>
            <input aria-describedby={invalidFields.has("email") ? GUIDANCE_ID : undefined} aria-invalid={invalidFields.has("email") || undefined} autoComplete="email" id="account-reset-email" inputMode="email" name="email" onChange={() => setInvalidFields(new Set())} required type="email" />
          </fieldset>
        )}
          </form>
        ) : null}
      </div>
      <div
        className="account-auth-secondary"
        data-has-legal={context.legalLinks.length > 0 || undefined}
      >
        <div className="account-card__links">
          <a href={contextualPath("/login", context, internalMazerReturn)}>Log in</a>
        </div>
        <AccountLegalLinks context={context} />
      </div>
      <div className="account-auth-dock">
        <button className="catalog-button catalog-button--primary" disabled={!adapter || busy || cooldown.remaining > 0 || (recovery && !recoveryReady)} form="account-reset-form" type="submit">
          {busy
            ? "Working…"
            : actionNotice
              ? actionNotice.text
              : recovery
                ? "Save new password"
                : context.resetLabel}
        </button>
      </div>
    </section>
  );
}

function LinkHandler({
  context,
  mode,
  resolution,
}: {
  context: AccountExperienceContext;
  mode: "callback" | "confirm";
  resolution: AdapterResolution | null;
}) {
  const hydrated = useHydrated();
  const adapter = adapterFrom(resolution);
  const processed = useRef<OneShotAttemptState>({ started: false });
  const redirectTimer = useRef<number | null>(null);
  const [notice, setNotice] = useState<Notice>({
    kind: "info",
    text: "One moment…",
  });
  const [returnTo, setReturnTo] = useState<string>(accountContract.accountPath);

  useEffect(() => {
    if (!hydrated) return;
    const scheduleRedirect = (target: string) => {
      if (redirectTimer.current !== null) return;
      redirectTimer.current = window.setTimeout(() => {
        redirectTimer.current = null;
        window.location.assign(sanitizeReturnTarget(target));
      }, 1400);
    };
    const cancelAttempt = scheduleDeferredAttempt(processed.current, () => {
      const url = new URL(window.location.href);

      if (mode === "confirm") {
        const payload = parseConfirmPayload(url);
        sanitizeAuthUrl();
        if (!payload) {
          setNotice({
            kind: "error",
            text: "Link incomplete. Request a new link.",
            variant: "invalid",
          });
          return;
        }
        setReturnTo(payload.returnTo);
        if (isFitnessReturnTarget(payload.returnTo)) {
          let storedState: string | null = null;
          try {
            storedState = window.localStorage.getItem(accountContract.confirmationStateKey);
          } catch { /* Unavailable browser storage cannot prove the initiating browser. */ }
          if (!confirmationStateMatches(payload.state, storedState)) {
            setNotice({
              kind: "error",
              text: "Opened in a different browser. Start again.",
              variant: "unauthorized",
            });
            return;
          }
          try {
            window.localStorage.removeItem(accountContract.confirmationStateKey);
          } catch {
            setNotice({
              kind: "error",
              text: "Browser storage unavailable. Start again.",
              variant: "unauthorized",
            });
            return;
          }
        }
        if (!adapter) {
          setNotice({
            kind: "info",
            text: "Not available on this site.",
            variant: "unavailable",
          });
          return;
        }
        adapter
          .confirm(payload.tokenHash, payload.type)
          .then(async (session) => {
            const destination = await completeAuthenticatedReturn(
              adapter,
              payload.returnTo,
              session,
            );
            setReturnTo(destination);
            setNotice({ kind: "success", text: "Confirmed." });
          })
          .catch((error) => setNotice({
            kind: "error",
            text: error instanceof FitnessHandoffError ? error.message : safeAuthError("confirm"),
          }));
        return;
      }

      const payload = parseCallbackPayload(url);
      sanitizeAuthUrl();
      if (!payload) {
        setNotice({
          kind: "error",
          text: "Sign-in link incomplete.",
          variant: "invalid",
        });
        return;
      }
      setReturnTo(payload.returnTo);
      const receipt = callbackReceiptKey(payload.code);
      if (window.sessionStorage.getItem(receipt) === "complete") {
        setNotice({ kind: "success", text: "Already signed in." });
        scheduleRedirect(payload.returnTo);
        return;
      }
      const storedState = window.sessionStorage.getItem(accountContract.callbackStateKey);
      if (!callbackStateMatches(payload.state, storedState)) {
        setNotice({
          kind: "error",
          text: "Opened in a different browser. Start again.",
          variant: "unauthorized",
        });
        return;
      }
      if (!adapter) {
        setNotice({
          kind: "info",
          text: "Not available on this site.",
          variant: "unavailable",
        });
        return;
      }
      adapter
        .exchangeCode(payload.code)
        .then(async (session) => {
          const destination = await completeAuthenticatedReturn(
            adapter,
            payload.returnTo,
            session,
          );
          window.sessionStorage.setItem(receipt, "complete");
          window.sessionStorage.removeItem(accountContract.callbackStateKey);
          setReturnTo(destination);
          setNotice({ kind: "success", text: "Signed in." });
          scheduleRedirect(destination);
        })
        .catch((error) => setNotice({
          kind: "error",
          text: error instanceof FitnessHandoffError ? error.message : safeAuthError("callback"),
        }));
    });

    return () => {
      cancelAttempt();
      if (redirectTimer.current !== null) {
        window.clearTimeout(redirectTimer.current);
        redirectTimer.current = null;
      }
    };
  }, [adapter, context.id, hydrated, mode]);

  const variant = noticeVariant(notice);
  const title =
    variant === "pending"
      ? "Checking your link."
      : variant === "success"
        ? "You are all set."
        : variant === "invalid"
          ? "This link is invalid."
          : variant === "unauthorized"
            ? "This link does not match."
            : variant === "unavailable"
              ? "Account service unavailable."
              : variant === "expired"
                ? "This link has expired."
                : "Something went wrong.";
  const actions =
    variant === "success" ? (
      <a className="catalog-button catalog-button--primary" href={sanitizeReturnTarget(returnTo)}>
        Continue safely
      </a>
    ) : variant === "pending" ? null : variant === "unavailable" ? (
      <a
        className="catalog-button catalog-button--primary"
        href={contextualPath("/account", context)}
      >
        View account status
      </a>
    ) : (
      <a
        className="catalog-button catalog-button--primary"
        href={contextualPath("/login", context)}
      >
        Start again
      </a>
    );

  return (
    <section
      className="account-card surface-panel"
      data-auth-product={context.id}
      data-auth-state={variant}
    >
      <RuntimeNote />
      <SystemState
        actions={actions}
        description={notice.text}
        details={
          <p>Details are used once, then sent only to approved {productIdentity.publicName} pages.</p>
        }
        eyebrow={mode === "confirm" ? "Account confirmation" : "Secure sign-in"}
        framed={false}
        title={title}
        variant={variant}
      />
    </section>
  );
}

export function AccountPortal({ mode }: { mode: PortalMode }) {
  const resolution = useAdapterResolution();
  const context = useAccountExperienceContext();

  switch (mode) {
    case "login":
      return <LoginPanel context={context} resolution={resolution} />;
    case "account":
      return <AccountPanel context={context} resolution={resolution} />;
    case "reset":
      return <ResetPanel context={context} resolution={resolution} />;
    case "confirm":
    case "callback":
      return <LinkHandler context={context} mode={mode} resolution={resolution} />;
  }
}
