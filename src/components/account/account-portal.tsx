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
import { syncOwnerHint, writeOwnerHint } from "@/lib/projects/owner-hint-sync";
import {
  callbackReceiptKey,
  callbackStateMatches,
  confirmationStateMatches,
  parseCallbackPayload,
  parseConfirmPayload,
  parseRecoveryPayload,
  sanitizeAuthUrl,
  sanitizeLinkDestination,
  sanitizeRecoveryUrl,
} from "@/lib/auth/callback-contract";
import {
  createRevalidationGate,
  scheduleCooldownTicks,
  scheduleDeferredAttempt,
  type OneShotAttemptState,
} from "@/lib/auth/client-lifecycle";
import {
  resolvePortalAuthAdapter,
  type AdapterResolution,
  type PortalAuthAdapter,
  type PortalSession,
} from "@/lib/auth/browser-adapter";
import { FitnessHandoffError } from "@/lib/auth/fitness-handoff";
import { AUTH_COPY, authNotice, type AuthMessageId, type AuthNotice } from "@/lib/auth/copy-matrix";
import {
  fieldsFor,
  LOGIN_NOTICE_PARAM,
  loginNoticeFromQuery,
  newPasswordProblem,
  passwordSaveFailure,
  resetRequestFailure,
  resetRequestProblem,
  signInFailure,
  signInProblem,
  signUpFailure,
  signUpProblem,
  type AuthField as FieldName,
  type FormProblem,
} from "@/lib/auth/auth-outcomes";
import { TurnstileField, type TurnstileFieldHandle } from "@/components/account/turnstile-field";
import { resolveSignOutDestination, SIGNOUT_RETURN_PARAM } from "@/config/account-signout";
import {
  authAccentStyle,
  AuthDock,
  AuthField,
  AuthHead,
  AuthLegal,
  AuthLinks,
  AuthNoticeSlot,
  AuthStatus,
} from "@/components/account/auth-surface";

type PortalMode = "login" | "account" | "confirm" | "callback" | "reset" | "signout";

const emptySubscribe = () => () => undefined;
const SIGNUP_SETTLEMENT_MINIMUM_MS = 500;
const THROTTLED_COOLDOWN_SECONDS = 8;
/** A confirmation or reset link can be asked for again after this many seconds. */
const RESEND_SECONDS = 30;

async function settleSignupAttempt(
  adapter: PortalAuthAdapter,
  email: string,
  password: string,
  username: string,
  context: AccountExperienceContext,
  returnTarget?: string,
  captchaToken?: string,
) {
  const [result] = await Promise.allSettled([
    adapter.signUp(email, password, username, context.id, returnTarget, captchaToken),
    new Promise((resolve) => window.setTimeout(resolve, SIGNUP_SETTLEMENT_MINIMUM_MS)),
  ]);
  // A rejection keeps its error so the caller can map it to one copy-matrix line.
  return result.status === "fulfilled"
    ? { failed: false as const, session: result.value, error: null }
    : { failed: true as const, session: null, error: result.reason as unknown };
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
    // Remembering who signed in is optional; authentication must still proceed.
  }
}

function forgetRememberedIdentity() {
  try {
    window.localStorage.removeItem(accountContract.rememberedIdentityKey);
  } catch {
    // Nothing stored or storage blocked: nothing to forget.
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

/**
 * The screen's one message and the fields it points at. A message stays until the person types or
 * submits again; it never times out and never moves into the button.
 */
function useFormNotice() {
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [fields, setFields] = useState<ReadonlySet<FieldName>>(() => new Set());
  return {
    fields,
    notice,
    clear() {
      setNotice(null);
      setFields(new Set());
    },
    edited(field: FieldName) {
      setNotice(null);
      setFields((current) => {
        if (!current.has(field)) return current;
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    },
    problem(problem: FormProblem) {
      setNotice(authNotice(problem.id));
      setFields(new Set(problem.fields));
    },
    show(id: AuthMessageId, email?: string | null) {
      setNotice(authNotice(id, email));
      setFields(new Set(fieldsFor(id)));
    },
  };
}

function focusField(id: string | undefined) {
  if (!id) return;
  const element = document.getElementById(id);
  if (element instanceof HTMLElement) element.focus();
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

function isLocalTestOrigin() {
  return classifyRuntimeOrigin(window.location.origin) === "local-test";
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

function useInternalMazerReturn(context: AccountExperienceContext) {
  const hydrated = useHydrated();
  const returnTarget = hydrated
    ? sanitizePostAuthReturnTarget(new URLSearchParams(window.location.search).get("returnTo"), context)
    : null;
  return returnTarget === "/oauth/authorize" ? returnTarget : undefined;
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

function adapterFrom(resolution: AdapterResolution | null): PortalAuthAdapter | null {
  return resolution?.status === "ready" ? resolution.adapter : null;
}

/** `/login?notice=<key>` from another screen (allowlist); removed from the address once read. */
function useQueryLoginNotice(hydrated: boolean) {
  const id = useMemo(
    () => (hydrated ? loginNoticeFromQuery(new URLSearchParams(window.location.search).getAll(LOGIN_NOTICE_PARAM)) : null),
    [hydrated],
  );
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(LOGIN_NOTICE_PARAM)) return;
    url.searchParams.delete(LOGIN_NOTICE_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [hydrated]);
  return id;
}

const LOGIN_FIELD_IDS: Record<FieldName, string> = {
  confirmation: "account-confirm-password",
  email: "account-email",
  identifier: "account-email",
  password: "account-password",
  username: "account-username",
};

function LoginPanel({
  context,
  resolution,
}: {
  context: AccountExperienceContext;
  resolution: AdapterResolution | null;
}) {
  const hydrated = useHydrated();
  // `?intent=signup` picks the form the screen opens on. Once the person switches, their choice wins
  // for the rest of the visit (it is never re-derived from the address).
  const requestedIntent: AccountAuthIntent = hydrated
    ? resolveAccountAuthIntent(new URLSearchParams(window.location.search).getAll("intent"))
    : "login";
  const [chosenIntent, setChosenIntent] = useState<AccountAuthIntent | null>(null);
  const intent = chosenIntent ?? requestedIntent;
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  // Sign-up that the provider accepted but wants confirmed by email: the values stay, locked.
  const [sent, setSent] = useState<{ email: string; username: string } | null>(null);
  const sentPassword = useRef("");
  // Fields are disabled while a request runs, so a rejected field takes focus once the form is live again.
  const pendingFocus = useRef<string | undefined>(undefined);
  const form = useFormNotice();
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [rememberedIdentity, setRememberedIdentity] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState(false);
  const storedRememberedIdentity = useSyncExternalStore(emptySubscribe, readRememberedIdentity, () => null);
  const cooldown = useCooldown();
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const queryNotice = useQueryLoginNotice(hydrated);
  const [queryNoticeDismissed, setQueryNoticeDismissed] = useState(false);
  const adapter = adapterFrom(resolution);
  const remembered = intent === "login" && !forgotten
    ? rememberedIdentity ?? storedRememberedIdentity
    : null;
  const internalMazerReturn = useInternalMazerReturn(context);

  const notice: AuthNotice | null =
    (resolution && !adapter ? authNotice("signin.unavailable") : null) ??
    form.notice ??
    (captchaBroken ? authNotice("captcha.load") : null) ??
    (queryNotice && !queryNoticeDismissed ? authNotice(queryNotice) : null);

  useEffect(() => {
    if (!adapter || remembered || forgotten) return;
    let active = true;
    adapter
      .getSession()
      .then((session) => {
        if (!active || !session) return;
        const identity = session.displayName || session.email;
        if (!identity) return;
        writeRememberedIdentity(identity);
        setRememberedIdentity(identity);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [adapter, forgotten, remembered]);

  function clearAll() {
    form.clear();
    setQueryNoticeDismissed(true);
  }

  function edited(field: FieldName) {
    form.edited(field);
    setQueryNoticeDismissed(true);
  }

  function showProblem(problem: FormProblem) {
    form.problem(problem);
    setQueryNoticeDismissed(true);
    focusField(LOGIN_FIELD_IDS[problem.fields[0]]);
  }

  function switchIntent(next: AccountAuthIntent) {
    setChosenIntent(next);
    setSent(null);
    sentPassword.current = "";
    clearAll();
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function forgetIdentity() {
    forgetRememberedIdentity();
    setRememberedIdentity(null);
    setForgotten(true);
    clearAll();
  }

  function noticeAction() {
    switch (notice?.id) {
      case "captcha.load":
        setCaptchaBroken(false);
        setCaptchaKey((key) => key + 1);
        form.clear();
        return;
      case "captcha.fail":
        captchaRef.current?.reset();
        form.clear();
        return;
      case "signup.emailexists":
        switchIntent("login");
        return;
    }
  }

  /** Leave for the destination, or record it on the deterministic local test origin. */
  function continueTo(destination: string) {
    if (isLocalTestOrigin()) {
      document.documentElement.dataset.postAuthDestination = destination;
      return;
    }
    setLeaving(true);
    window.location.assign(destination);
  }

  async function submitSignup(values: { email: string; username: string }, password: string) {
    if (!adapter) return;
    const problem = signUpProblem({ ...values, password });
    if (problem) {
      showProblem(problem);
      return;
    }
    setBusy(true);
    clearAll();
    cooldown.start();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      const attempt = await settleSignupAttempt(
        adapter,
        values.email,
        password,
        values.username,
        context,
        internalMazerReturn,
        captchaToken,
      );
      if (attempt.failed) {
        const id = signUpFailure(attempt.error);
        form.show(id);
        pendingFocus.current = LOGIN_FIELD_IDS[fieldsFor(id)[0]];
        return;
      }
      if (!attempt.session) {
        // The provider wants the email confirmed first (or the email is already in use, which it
        // deliberately does not say). Either way the next step is the inbox.
        sentPassword.current = password;
        setSent(values);
        form.show("signup.sent", values.email);
        cooldown.start(RESEND_SECONDS);
        return;
      }
      const session = attempt.session;
      writeRememberedIdentity(session.displayName || values.username);
      const destination = context.id === "fitness"
        ? await adapter.handoffToFitness(
            sanitizeContextReturnTarget(new URLSearchParams(window.location.search).get("returnTo"), context),
            session.userId,
          )
        : internalMazerReturn ?? resolvePostAuthTarget(context);
      // Record whether this account is the owner before leaving, so main-site pages can show the Projects link.
      if (context.id === "website") await syncOwnerHint(adapter);
      continueTo(destination);
    } catch (error) {
      form.show(signUpFailure(error));
    } finally {
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || leaving || cooldown.remaining) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");

    if (intent === "signup") {
      await submitSignup(
        sent ?? { email: email.trim(), username: username.trim() },
        sent ? sentPassword.current : password,
      );
      return;
    }

    const identifier = (remembered ?? String(data.get("email") ?? "")).trim();
    const problem = signInProblem(identifier, password);
    if (problem) {
      showProblem(problem);
      return;
    }
    setBusy(true);
    clearAll();
    cooldown.start();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      const session = await adapter.signIn(identifier, password, captchaToken);
      if (!session) {
        form.show("signin.wrong");
        return;
      }
      writeRememberedIdentity(session.displayName || identifier);
      const postAuthTarget = resolvePostAuthTarget(context);
      const destination = context.id === "fitness" && !postAuthTarget.startsWith("/")
        ? await adapter.handoffToFitness(postAuthTarget, session.userId)
        : postAuthTarget;
      // Record whether this account is the owner before leaving, so main-site pages can show the Projects link.
      if (context.id === "website") await syncOwnerHint(adapter);
      continueTo(destination);
    } catch (error) {
      const id = signInFailure(error);
      if (id === "signin.throttled") cooldown.start(THROTTLED_COOLDOWN_SECONDS);
      form.show(id);
    } finally {
      // Tokens are single use: a failed attempt must get a fresh check.
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  // "Not you?" swaps the locked field for an empty one: put the cursor there so typing starts at once.
  useEffect(() => {
    if (forgotten) focusField(LOGIN_FIELD_IDS.identifier);
  }, [forgotten]);

  const working = busy || leaving;
  useEffect(() => {
    if (working || !pendingFocus.current) return;
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
  }, [working]);
  const dockLabel = intent === "login"
    ? working ? AUTH_COPY.working.signingIn : AUTH_COPY.button.signIn
    : working
      ? AUTH_COPY.working.creatingAccount
      : sent && cooldown.remaining > 0
        ? AUTH_COPY.resendIn(cooldown.remaining)
        : AUTH_COPY.button.createAccount;
  const invalid = (field: FieldName) => form.fields.has(field);
  const describedBy = (field: FieldName) => (invalid(field) ? "auth-notice" : undefined);

  return (
    <section
      aria-labelledby="login-panel-title"
      className="auth-surface"
      data-auth-intent={intent}
      data-auth-product={context.id}
      data-auth-surface="credentials"
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead
        context={context}
        title={intent === "signup"
          ? AUTH_COPY.title.createAccount
          : remembered
            ? AUTH_COPY.title.welcomeBack
            : AUTH_COPY.title.welcome}
        titleId="login-panel-title"
      />
      <form className="auth-body" id="account-auth-form" noValidate onSubmit={submit}>
        {intent === "login" ? (
          <>
            {remembered ? (
              <AuthField
                autoComplete="username"
                id="account-email"
                key="remembered"
                label={remembered.includes("@") ? AUTH_COPY.field.email : AUTH_COPY.field.username}
                locked
                name="email"
                value={remembered}
              />
            ) : (
              <AuthField
                autoComplete="username"
                describedBy={describedBy("identifier")}
                disabled={working}
                id="account-email"
                invalid={invalid("identifier")}
                key="identifier"
                label={AUTH_COPY.field.identifier}
                name="email"
                onChange={() => edited("identifier")}
              />
            )}
            <AuthField
              autoComplete="current-password"
              describedBy={describedBy("password")}
              disabled={working}
              id="account-password"
              invalid={invalid("password")}
              label={AUTH_COPY.field.password}
              name="password"
              onChange={() => edited("password")}
              secret
            />
          </>
        ) : sent ? (
          <>
            <AuthField id="account-username" label={AUTH_COPY.field.username} locked name="username" value={sent.username} />
            <AuthField id="account-email" label={AUTH_COPY.field.email} locked name="email" type="email" value={sent.email} />
          </>
        ) : (
          <>
            <AuthField
              autoComplete="username"
              describedBy={describedBy("username")}
              disabled={working}
              id="account-username"
              invalid={invalid("username")}
              label={AUTH_COPY.field.username}
              maxLength={15}
              name="username"
              onChange={(value) => {
                setUsername(value);
                edited("username");
              }}
              value={username}
            />
            <AuthField
              autoComplete="email"
              describedBy={describedBy("email")}
              disabled={working}
              id="account-email"
              inputMode="email"
              invalid={invalid("email")}
              label={AUTH_COPY.field.email}
              name="email"
              onChange={(value) => {
                setEmail(value);
                edited("email");
              }}
              type="email"
              value={email}
            />
            <AuthField
              autoComplete="new-password"
              describedBy={describedBy("password")}
              disabled={working}
              id="account-password"
              invalid={invalid("password")}
              label={AUTH_COPY.field.password}
              name="password"
              onChange={() => edited("password")}
              secret
            />
          </>
        )}
        <TurnstileField key={captchaKey} onUnavailable={() => setCaptchaBroken(true)} ref={captchaRef} />
        <AuthNoticeSlot notice={notice} onAction={noticeAction} />
      </form>
      <AuthLinks>
        {intent === "login"
          ? remembered
            ? [<button key="not-you" onClick={forgetIdentity} type="button">{AUTH_COPY.link.notYou}</button>]
            : [
                <button key="create" onClick={() => switchIntent("signup")} type="button">{AUTH_COPY.link.createAccount}</button>,
                <a href={contextualPath("/reset-password", context, internalMazerReturn)} key="reset">{AUTH_COPY.link.resetPassword}</a>,
              ]
          : sent
            ? [
                <button
                  key="wrong-email"
                  onClick={() => {
                    setSent(null);
                    sentPassword.current = "";
                    clearAll();
                  }}
                  type="button"
                >
                  {AUTH_COPY.link.wrongEmail}
                </button>,
              ]
            : [<button key="sign-in" onClick={() => switchIntent("login")} type="button">{AUTH_COPY.link.signIn}</button>]}
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock busy={working} disabled={!adapter || cooldown.remaining > 0} form="account-auth-form">
        {dockLabel}
      </AuthDock>
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
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [busy, setBusy] = useState(false);
  // True from the moment this page asks to sign out until it has chosen its own destination. The
  // provider announces SIGNED_OUT before adapter.signOut() resolves, so without this the
  // "session lost" redirect below would send the person to /login ahead of the product origin.
  const signingOutRef = useRef(false);
  // A session that ends while the page is open (expiry, a sign-out elsewhere) gets a reason on the
  // sign-in screen; a visit without any session just goes to sign in.
  const hadSessionRef = useRef(false);

  useEffect(() => {
    if (session) hadSessionRef.current = true;
  }, [session]);

  useEffect(() => {
    if (adapter && loaded && !session && !error && !signingOutRef.current) {
      if (isLocalTestOrigin()) {
        document.documentElement.dataset.sessionLostRedirect = "login";
      }
      const path = hadSessionRef.current ? `/login?${LOGIN_NOTICE_PARAM}=session` : "/login";
      window.location.replace(contextualPath(path, context));
    }
  }, [adapter, context, error, loaded, session]);

  async function signOut() {
    if (!adapter || signingOutRef.current) return;
    signingOutRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await adapter.signOut();
      writeOwnerHint(false);
      const destination = new URL("/", context.destinationOrigin);
      if (context.id === "website") destination.searchParams.set("signedOut", "1");
      if (isLocalTestOrigin()) {
        // Deterministic harness: record the real destination instead of leaving the test origin.
        document.documentElement.dataset.signOutDestination = destination.href;
        setBusy(false);
        return;
      }
      window.location.assign(destination.href);
    } catch {
      signingOutRef.current = false;
      setNotice(authNotice("account.signoutfail"));
      setBusy(false);
    }
  }

  const unavailable = Boolean(resolution && !adapter);
  if (!unavailable && !error && !session) {
    // Checking, or on the way to sign in: a transient loader, never an empty form.
    return (
      <AuthStatus
        context={context}
        spin
        state="checking"
        surface="account-status"
        title={AUTH_COPY.title.checkingAccount}
      >
        <RuntimeNote />
      </AuthStatus>
    );
  }

  const shownNotice = unavailable
    ? authNotice("signin.unavailable")
    : error
      ? authNotice("account.loadfail")
      : notice;

  return (
    <section
      aria-labelledby="account-status-title"
      className="auth-surface"
      data-auth-product={context.id}
      data-auth-state={session ? "ready" : unavailable ? "unavailable" : "error"}
      data-auth-surface="account-status"
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead
        context={context}
        lead={session ? AUTH_COPY.lead.account : undefined}
        title={AUTH_COPY.title.account}
        titleId="account-status-title"
      />
      <div className="auth-body">
        <AuthField
          id="account-current-username"
          label={AUTH_COPY.field.username}
          locked
          name="username"
          value={session ? session.displayName ?? deriveIdentity(session.email ?? "") : ""}
        />
        <AuthField
          id="account-current-email"
          label={AUTH_COPY.field.email}
          locked
          name="email"
          type="email"
          value={session?.email ?? ""}
        />
        <AuthNoticeSlot
          notice={shownNotice}
          onAction={shownNotice?.id === "account.loadfail" ? () => window.location.reload() : undefined}
        />
      </div>
      <AuthLinks>
        <a href={contextualPath("/reset-password", context)}>{AUTH_COPY.link.resetPassword}</a>
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock busy={busy} disabled={!session} onClick={signOut}>
        {busy ? AUTH_COPY.working.signingOut : AUTH_COPY.button.signOut}
      </AuthDock>
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

/** The signed-in email for the reset request (`undefined` while unknown, `null` when signed out). */
function useSignedInEmail(adapter: PortalAuthAdapter | null, enabled: boolean) {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!adapter || !enabled) return;
    let active = true;
    adapter
      .getSession()
      .then((session) => {
        if (active) setEmail(session?.email ?? null);
      })
      .catch(() => {
        if (active) setEmail(null);
      });
    return () => {
      active = false;
    };
  }, [adapter, enabled]);
  return email;
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
  const form = useFormNotice();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [linkNoticeDismissed, setLinkNoticeDismissed] = useState(false);
  const cooldown = useCooldown();
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const recoveryState = useRecoverySession(hydrated, recovery, resolution);
  // A dead link (invalid, expired, or the exchange failed) lands on the request form with the reason.
  const recoveryLinkDead = recovery && (
    recoveryState === "invalid" ||
    recoveryState === "expired" ||
    recoveryState === "recoverable-error"
  );
  const newPassword = recovery && !recoveryLinkDead;
  const recoveryReady = newPassword && recoveryState === "ready";
  const signedInEmail = useSignedInEmail(adapter, hydrated && !newPassword);
  const internalMazerReturn = useInternalMazerReturn(context);

  const linkNotice: AuthMessageId | null = linkNoticeDismissed || !recovery
    ? null
    : recoveryState === "expired"
      ? "reset.expired"
      : recoveryState === "invalid" || recoveryState === "recoverable-error"
        ? "reset.invalid"
        : recoveryState === "setup-pending"
          ? "signin.unavailable"
          : null;
  const notice: AuthNotice | null =
    (resolution && !adapter ? authNotice("signin.unavailable") : null) ??
    form.notice ??
    (captchaBroken && !newPassword ? authNotice("captcha.load") : null) ??
    (linkNotice ? authNotice(linkNotice) : null);

  function clearAll() {
    form.clear();
    setLinkNoticeDismissed(true);
  }

  function edited(field: FieldName) {
    form.edited(field);
    setLinkNoticeDismissed(true);
    setSentTo(null);
  }

  function noticeAction() {
    if (notice?.id === "captcha.load") {
      setCaptchaBroken(false);
      setCaptchaKey((key) => key + 1);
      form.clear();
    } else if (notice?.id === "captcha.fail") {
      captchaRef.current?.reset();
      form.clear();
    }
  }

  async function saveNewPassword(formElement: HTMLFormElement) {
    if (!adapter || !recoveryReady) return;
    const data = new FormData(formElement);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    const problem = newPasswordProblem(password, confirmation);
    if (problem) {
      form.problem(problem);
      focusField(problem.fields[0] === "confirmation" ? "account-confirm-password" : "account-new-password");
      return;
    }
    setBusy(true);
    clearAll();
    cooldown.start();
    try {
      await adapter.updatePassword(password);
      // MAZER-ACCT-041: a changed password ends every other session of the account (other devices,
      // Mazer, Fitness) while the recovery session is still alive to authorize it. The password is
      // already saved, so a failure here must not read as "not saved"; the recovery session is still
      // ended below and the person lands on sign in with the saved line.
      try {
        await adapter.signOut("other-sessions");
      } catch {
        // Reported gap: the copy matrix has no line for "saved, but other devices stay signed in".
      }
      // Then end this throw-away recovery session itself (local scope, as before).
      await adapter.signOut("this-session");
      formElement.reset();
      const destination = contextualPath(`/login?${LOGIN_NOTICE_PARAM}=resetdone`, context, internalMazerReturn);
      if (isLocalTestOrigin()) {
        // Deterministic harness: record where the saved password leads instead of leaving the page.
        document.documentElement.dataset.resetDestination = destination;
        return;
      }
      window.location.replace(destination);
    } catch (error) {
      form.show(passwordSaveFailure(error));
      setBusy(false);
    }
  }

  async function requestLink() {
    if (!adapter) return;
    const target = signedInEmail ?? (document.getElementById("account-reset-email") as HTMLInputElement | null)?.value.trim() ?? "";
    const problem = signedInEmail ? null : resetRequestProblem(target);
    if (problem) {
      form.problem(problem);
      setLinkNoticeDismissed(true);
      focusField("account-reset-email");
      return;
    }
    setBusy(true);
    clearAll();
    cooldown.start();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      await adapter.requestPasswordReset(target, context.id, internalMazerReturn, captchaToken);
      setSentTo(target);
      // Signed in, the address is already on screen; signed out, the answer must not reveal whether
      // an account uses the typed address.
      if (signedInEmail) form.show("reset.sent", signedInEmail);
      else form.show("reset.sentany");
      cooldown.start(RESEND_SECONDS);
    } catch (error) {
      const id = resetRequestFailure(error, Boolean(signedInEmail));
      form.show(id);
      if (id === "reset.sentany") {
        // Indistinguishable from a sent link, including the resend countdown.
        setSentTo(target);
        cooldown.start(RESEND_SECONDS);
      }
    } finally {
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || cooldown.remaining) return;
    if (newPassword) await saveNewPassword(event.currentTarget);
    else await requestLink();
  }

  const invalid = (field: FieldName) => form.fields.has(field);
  const describedBy = (field: FieldName) => (invalid(field) ? "auth-notice" : undefined);
  const dockLabel = newPassword
    ? busy ? AUTH_COPY.working.saving : AUTH_COPY.button.savePassword
    : busy
      ? AUTH_COPY.working.sending
      : sentTo && cooldown.remaining > 0
        ? AUTH_COPY.resendIn(cooldown.remaining)
        : AUTH_COPY.button.sendResetLink;

  return (
    <section
      aria-labelledby="reset-panel-title"
      className="auth-surface"
      data-auth-product={context.id}
      data-auth-state={recovery ? recoveryState : signedInEmail ? "signed-in" : "signed-out"}
      data-auth-surface="recovery"
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead
        context={context}
        lead={newPassword ? AUTH_COPY.lead.newPassword : AUTH_COPY.lead.resetRequest}
        title={newPassword ? AUTH_COPY.title.newPassword : AUTH_COPY.title.resetPassword}
        titleId="reset-panel-title"
      />
      <form className="auth-body" id="account-reset-form" noValidate onSubmit={submit}>
        {newPassword ? (
          <>
            <AuthField
              autoComplete="new-password"
              describedBy={describedBy("password")}
              disabled={!recoveryReady || busy}
              id="account-new-password"
              invalid={invalid("password")}
              label={AUTH_COPY.field.newPassword}
              name="password"
              onChange={() => edited("password")}
              secret
            />
            <AuthField
              autoComplete="new-password"
              describedBy={describedBy("confirmation")}
              disabled={!recoveryReady || busy}
              id="account-confirm-password"
              invalid={invalid("confirmation")}
              label={AUTH_COPY.field.confirmPassword}
              name="confirmation"
              onChange={() => edited("confirmation")}
              secret
            />
          </>
        ) : signedInEmail ? (
          <AuthField id="account-reset-email" label={AUTH_COPY.field.email} locked name="email" type="email" value={signedInEmail} />
        ) : (
          <AuthField
            autoComplete="email"
            describedBy={describedBy("email")}
            disabled={signedInEmail === undefined && Boolean(adapter)}
            id="account-reset-email"
            inputMode="email"
            invalid={invalid("email")}
            label={AUTH_COPY.field.email}
            name="email"
            onChange={() => edited("email")}
            type="email"
          />
        )}
        {newPassword ? null : (
          <TurnstileField key={captchaKey} onUnavailable={() => setCaptchaBroken(true)} ref={captchaRef} />
        )}
        <AuthNoticeSlot notice={notice} onAction={noticeAction} />
      </form>
      {newPassword ? null : (
        <AuthLinks>
          {signedInEmail ? (
            <a href={contextualPath("/account", context)}>{AUTH_COPY.link.backToAccount}</a>
          ) : (
            <a href={contextualPath("/login", context, internalMazerReturn)}>{AUTH_COPY.link.signIn}</a>
          )}
        </AuthLinks>
      )}
      <AuthLegal context={context} />
      <AuthDock
        busy={busy}
        disabled={!adapter || cooldown.remaining > 0 || (newPassword && !recoveryReady)}
        form="account-reset-form"
      >
        {dockLabel}
      </AuthDock>
    </section>
  );
}

/**
 * Email confirmation and sign-in callback. Both are transient: the person sees one loader, then lands
 * in the destination, or on sign in with the reason (`/login?notice=`). There is no dead-end screen.
 */
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

  useEffect(() => {
    if (!hydrated) return;
    // On the local test origin the outcome is recorded, and only same-origin pages are opened.
    const leave = (destination: string, outcome: string) => {
      if (isLocalTestOrigin()) {
        document.documentElement.dataset.linkOutcome = outcome;
        document.documentElement.dataset.linkDestination = destination;
        if (!destination.startsWith("/")) return;
      }
      window.location.replace(destination);
    };
    // Every link-derived destination passes the return-target allowlist once more right before
    // the browser moves (defence in depth; the payload parsers already sanitized `returnTo`).
    const go = (destination: string, outcome: string) => leave(sanitizeLinkDestination(destination), outcome);
    // The sign-in screen with an allowlisted notice key: built from constants, never from the link.
    const toLogin = (key: "callback" | "confirmed" | "unavailable", outcome: string) =>
      leave(contextualPath(`/login?${LOGIN_NOTICE_PARAM}=${key}`, context), outcome);
    const cancelAttempt = scheduleDeferredAttempt(processed.current, () => {
      const url = new URL(window.location.href);

      if (mode === "confirm") {
        const payload = parseConfirmPayload(url);
        sanitizeAuthUrl();
        if (!payload) {
          toLogin("callback", "invalid");
          return;
        }
        if (isFitnessReturnTarget(payload.returnTo)) {
          let storedState: string | null = null;
          try {
            storedState = window.localStorage.getItem(accountContract.confirmationStateKey);
          } catch { /* Unavailable browser storage cannot prove the initiating browser. */ }
          if (!confirmationStateMatches(payload.state, storedState)) {
            toLogin("callback", "unauthorized");
            return;
          }
          try {
            window.localStorage.removeItem(accountContract.confirmationStateKey);
          } catch {
            toLogin("callback", "unauthorized");
            return;
          }
        }
        if (!adapter) {
          toLogin("unavailable", "unavailable");
          return;
        }
        adapter
          .confirm(payload.tokenHash, payload.type)
          .then(async (session) => {
            if (!session && !isFitnessReturnTarget(payload.returnTo)) {
              toLogin("confirmed", "confirmed");
              return;
            }
            const destination = await completeAuthenticatedReturn(adapter, payload.returnTo, session);
            go(destination, "success");
          })
          .catch(() => toLogin("callback", "error"));
        return;
      }

      const payload = parseCallbackPayload(url);
      sanitizeAuthUrl();
      if (!payload) {
        toLogin("callback", "invalid");
        return;
      }
      const receipt = callbackReceiptKey(payload.code);
      if (window.sessionStorage.getItem(receipt) === "complete") {
        go(payload.returnTo, "complete");
        return;
      }
      const storedState = window.sessionStorage.getItem(accountContract.callbackStateKey);
      if (!callbackStateMatches(payload.state, storedState)) {
        toLogin("callback", "unauthorized");
        return;
      }
      if (!adapter) {
        toLogin("unavailable", "unavailable");
        return;
      }
      adapter
        .exchangeCode(payload.code)
        .then(async (session) => {
          const destination = await completeAuthenticatedReturn(adapter, payload.returnTo, session);
          window.sessionStorage.setItem(receipt, "complete");
          window.sessionStorage.removeItem(accountContract.callbackStateKey);
          go(destination, "success");
        })
        .catch(() => toLogin("callback", "error"));
    });

    return cancelAttempt;
  }, [adapter, context, hydrated, mode]);

  return (
    <AuthStatus
      context={context}
      lead={mode === "callback" ? AUTH_COPY.lead.usingAccount : undefined}
      spin
      state="pending"
      surface={mode}
      title={mode === "callback" ? AUTH_COPY.title.signingIn : AUTH_COPY.title.confirming}
    >
      <RuntimeNote />
    </AuthStatus>
  );
}

/**
 * GET /signout?returnTo=<url> (MAZER-ACCT-041). Ends THIS browser's account session (local scope:
 * the portal session is revoked at the provider and its stored copy removed; the person's other
 * devices stay signed in), clears the shared owner hint like the account page's Sign out does,
 * then continues to the allowlisted `returnTo` or to the sign-in page. It is a page, not a data
 * endpoint, because the session lives in this browser's storage and only this page can clear it.
 * Because the site sends X-Frame-Options: DENY, only a top-level navigation can trigger it.
 */
function SignOutPanel({
  context,
  resolution,
}: {
  context: AccountExperienceContext;
  resolution: AdapterResolution | null;
}) {
  const adapter = adapterFrom(resolution);
  const started = useRef(false);
  const [attemptState, setState] = useState<"working" | "error">("working");
  const [attempt, setAttempt] = useState(0);
  const state = resolution && !adapter ? "unavailable" : attemptState;

  useEffect(() => {
    if (!adapter || started.current) return;
    started.current = true;
    void (async () => {
      try {
        await adapter.signOut("this-session");
        writeOwnerHint(false);
        const destination = resolveSignOutDestination(
          new URLSearchParams(window.location.search).get(SIGNOUT_RETURN_PARAM),
          window.location.origin,
        );
        if (isLocalTestOrigin()) {
          // Deterministic harness: record the real destination instead of leaving the test origin.
          document.documentElement.dataset.signOutDestination = destination;
          return;
        }
        window.location.replace(destination);
      } catch {
        started.current = false;
        setState("error");
      }
    })();
  }, [adapter, attempt]);

  if (state === "working") {
    return (
      <AuthStatus context={context} spin state="working" surface="signout" title={AUTH_COPY.title.signingOut}>
        <RuntimeNote />
      </AuthStatus>
    );
  }

  return (
    <section
      aria-labelledby="signout-title"
      className="auth-surface"
      data-auth-product={context.id}
      data-auth-state={state}
      data-auth-surface="signout"
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead context={context} title={AUTH_COPY.title.signOut} titleId="signout-title" />
      <div className="auth-body">
        <AuthNoticeSlot notice={authNotice(state === "error" ? "account.signoutfail" : "signin.unavailable")} />
      </div>
      <AuthLinks>
        <a href={contextualPath("/login", context)}>{AUTH_COPY.link.signIn}</a>
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock
        disabled={state !== "error"}
        onClick={() => {
          setState("working");
          setAttempt((count) => count + 1);
        }}
      >
        {AUTH_COPY.button.tryAgain}
      </AuthDock>
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
    case "signout":
      return <SignOutPanel context={context} resolution={resolution} />;
    case "confirm":
    case "callback":
      return <LinkHandler context={context} mode={mode} resolution={resolution} />;
  }
}
