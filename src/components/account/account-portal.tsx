"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  accountContract,
  classifyRuntimeOrigin,
  resolveAccountAuthIntent,
  resolveAccountExperienceContext,
  RESET_BY_USERNAME_LIVE,
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
import { PASSWORD_MINIMUM } from "@/lib/auth/password-policy";
import { AUTH_COPY, authNotice, type AuthMessageId, type AuthNotice } from "@/lib/auth/copy-matrix";
import {
  fieldsFor,
  LOGIN_NOTICE_PARAM,
  loginNoticeFromQuery,
  newPasswordProblem,
  passwordSaveFailure,
  resetRequestFailure,
  resetRequestProblem,
  resetUsernameProblem,
  signInFailure,
  signInProblem,
  signUpFailure,
  signUpProblem,
  type AuthField as FieldName,
  type FormProblem,
  usernameResetFailure,
} from "@/lib/auth/auth-outcomes";
import {
  ACCOUNT_NOTICE_PARAM,
  accountNoticeFromQuery,
  changeFieldsFor,
  emailChangeFailure,
  emailChangeLandingKey,
  emailChangeProblem,
  nextRememberedIdentity,
  reauthFailure,
  reauthProblem,
  usernameChangeFailure,
  usernameChangeNotice,
  usernameChangeProblem,
  type ChangeField,
  type ChangeProblem,
} from "@/lib/auth/account-change";
import {
  accountDeleteFailure,
  accountDeleteNotice,
  deleteConfirmProblem,
  deleteFieldsFor,
  deleteReauthFailure,
  deleteReauthProblem,
  isAccountGone,
  type DeleteProblem,
  type DeleteStep,
} from "@/lib/auth/account-delete";
import { mazerNameFailure, mazerNameIsSoleUsername, mazerNameProblem, showMazerNameRow } from "@/lib/auth/mazer-name";
import {
  recordResetSent,
  recoveryLandingPath,
  recoveryLinkFailure,
  RESET_LINK_PARAM,
  RESET_RESEND_SECONDS,
  resetLinkNotice,
  resetWaitRemaining,
} from "@/lib/auth/recovery-link";
import { TurnstileField, type TurnstileFieldHandle } from "@/components/account/turnstile-field";
import { resolveSignOutDestination, SIGNOUT_RETURN_PARAM } from "@/config/account-signout";
import { MAZER_ACCOUNT_ACTION_PARAM, mazerAccountActionUrl } from "@/config/mazer-account-actions";
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

/** This browser's localStorage, or null where reading it throws (blocked storage). */
function browserLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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

/**
 * `/login?notice=<key>` (or `/account?notice=<key>`) from another screen (allowlist); removed from the
 * address once read.
 */
function useQueryLoginNotice(
  hydrated: boolean,
  parse: (values: string[]) => AuthMessageId | null = loginNoticeFromQuery,
) {
  const id = useMemo(
    () => (hydrated ? parse(new URLSearchParams(window.location.search).getAll(LOGIN_NOTICE_PARAM)) : null),
    // The parser is a module-level allowlist, so it never changes between renders.
    [hydrated, parse],
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
                inputMode="email"
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
              newPasswordMinimum={PASSWORD_MINIMUM}
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
  const hydrated = useHydrated();
  const { error, loaded, session, setSession } = usePortalSession(adapter);
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [busy, setBusy] = useState(false);
  // Change username / change email (design point 12): which row is being changed, if any.
  const [changing, setChanging] = useState<ChangeField | null>(null);
  // Delete account: true while the delete screen is open.
  const [deleting, setDeleting] = useState(false);
  // Mazer name (MAZER-ACCT-047): the name other players see in Mazer, null when the account has no Mazer profile.
  const [mazerName, setMazerName] = useState<string | null>(null);
  const [renamingMazer, setRenamingMazer] = useState(false);
  const sessionUserId = session?.userId ?? null;
  // Sign out everywhere: true while the notice box asks to confirm (step 1 of 2).
  const [confirmingEverywhere, setConfirmingEverywhere] = useState(false);
  // `/account?notice=` from an opened email-change link (allowlist).
  const queryNotice = useQueryLoginNotice(hydrated, accountNoticeFromQuery);
  const [queryNoticeDismissed, setQueryNoticeDismissed] = useState(false);
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

  // Read the Mazer name once per signed-in account. A failed read hides the row (or leaves it empty
  // when the person came from Mazer); it never blocks the account page.
  useEffect(() => {
    if (!adapter || !sessionUserId) return;
    let active = true;
    adapter
      .readMazerName()
      .then((name) => {
        if (active) setMazerName(name);
      })
      .catch(() => {
        if (active) setMazerName(null);
      });
    return () => {
      active = false;
    };
  }, [adapter, sessionUserId]);

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
    setConfirmingEverywhere(false);
    try {
      // The dock ends only THIS device's session (local scope); "Sign out everywhere" is the global one.
      await adapter.signOut("this-session");
      writeOwnerHint(false);
      const destination = new URL("/", context.destinationOrigin);
      if (context.id === "website") destination.searchParams.set("signedOut", "1");
      // MAZER-UI-100: Mazer keeps its own session, so it is told to end it too (closed-set key, no secret).
      if (context.id === "mazer") destination.searchParams.set(MAZER_ACCOUNT_ACTION_PARAM, "signed-out");
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

  /**
   * Sign out everywhere, step 2 (step 1 is the "Sign out everywhere" link, which only asks in the
   * notice box). Global scope at the provider: every session of the account, on every device and in
   * every app, loses its refresh token. Lands on this host's sign-in with the done line. A failure
   * keeps the person here, signed in, with the unavailable line.
   */
  async function signOutEverywhere() {
    if (!adapter || signingOutRef.current) return;
    signingOutRef.current = true;
    setBusy(true);
    try {
      await adapter.signOut("everywhere");
      writeOwnerHint(false);
      const destination = contextualPath(`/login?${LOGIN_NOTICE_PARAM}=everywhere`, context);
      if (isLocalTestOrigin()) {
        // Deterministic harness: record the destination, then land on it signed out in the same harness.
        document.documentElement.dataset.signOutDestination = destination;
        const landing = new URL(destination, window.location.origin);
        landing.searchParams.set("auth_test", "success");
        window.location.replace(`${landing.pathname}${landing.search}`);
        return;
      }
      window.location.replace(destination);
    } catch {
      signingOutRef.current = false;
      setConfirmingEverywhere(false);
      setNotice(authNotice("change.unavailable"));
      setBusy(false);
    }
  }

  function askSignOutEverywhere() {
    setQueryNoticeDismissed(true);
    setNotice(null);
    setConfirmingEverywhere(true);
  }

  // Step 1 moved focus to the confirm action; Cancel puts it back on the link it came from.
  useEffect(() => {
    if (confirmingEverywhere) {
      document.querySelector<HTMLButtonElement>(".auth-notice__action")?.focus({ preventScroll: true });
    }
  }, [confirmingEverywhere]);

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
      : confirmingEverywhere && session
        ? authNotice("account.everywhereconfirm")
        : notice ?? (queryNotice && !queryNoticeDismissed ? authNotice(queryNotice, session?.email) : null);
  const currentUsername = session ? session.displayName ?? deriveIdentity(session.email ?? "") : "";

  function startChange(field: ChangeField) {
    setNotice(null);
    setQueryNoticeDismissed(true);
    setConfirmingEverywhere(false);
    setChanging(field);
  }

  /**
   * MAZER-UI-100: Reset progress (Mazer only). The reset itself and its confirmation stay in Mazer,
   * which owns the progress on its own origin; this row only opens Mazer on that confirmation.
   */
  function resetMazerProgress() {
    const destination = mazerAccountActionUrl("reset-progress", context.destinationOrigin);
    if (isLocalTestOrigin()) {
      // Deterministic harness: record the real destination instead of leaving the test origin.
      document.documentElement.dataset.mazerAccountAction = destination;
      return;
    }
    window.location.assign(destination);
  }

  function startMazerRename() {
    setNotice(null);
    setQueryNoticeDismissed(true);
    setConfirmingEverywhere(false);
    setRenamingMazer(true);
  }

  function startDelete() {
    setNotice(null);
    setQueryNoticeDismissed(true);
    setConfirmingEverywhere(false);
    setDeleting(true);
  }

  /**
   * The account is gone (deleted now, or already). Every session died with it at the provider and
   * the adapter cleared this browser's copy. Forget the remembered name if it was this account, then
   * land on this host's sign-in with the done line.
   */
  function finishDelete(deletedSession: PortalSession, deletedName: string) {
    writeOwnerHint(false);
    const remembered = readRememberedIdentity()?.toLowerCase();
    if (remembered && [deletedName, deletedSession.email ?? ""].some((value) => value.trim().toLowerCase() === remembered)) {
      forgetRememberedIdentity();
    }
    const destination = contextualPath(`/login?${LOGIN_NOTICE_PARAM}=deleted`, context);
    if (isLocalTestOrigin()) {
      // Deterministic harness: record the destination, then land on it signed out in the same harness.
      document.documentElement.dataset.signOutDestination = destination;
      const landing = new URL(destination, window.location.origin);
      landing.searchParams.set("auth_test", "success");
      window.location.replace(`${landing.pathname}${landing.search}`);
      return;
    }
    window.location.replace(destination);
  }

  if (adapter && session && deleting) {
    return (
      <AccountDeletePanel
        adapter={adapter}
        context={context}
        currentUsername={currentUsername}
        onCancel={() => setDeleting(false)}
        onDeleteSettled={(gone) => {
          if (gone) finishDelete(session, currentUsername);
          else signingOutRef.current = false;
        }}
        onDeleteStarting={() => {
          // The provider announces the lost session before the call returns; this page picks the
          // destination itself (the done line), not the "session ended" redirect.
          signingOutRef.current = true;
        }}
        session={session}
      />
    );
  }

  if (adapter && session && renamingMazer) {
    return (
      <MazerNamePanel
        adapter={adapter}
        context={context}
        currentName={mazerName}
        solo={mazerNameIsSoleUsername(context.id, true)}
        onCancel={() => setRenamingMazer(false)}
        onSaved={(next) => {
          setMazerName(next);
          setNotice(authNotice("mazer.namedone"));
          setRenamingMazer(false);
        }}
      />
    );
  }

  if (adapter && session && changing) {
    return (
      <AccountChangePanel
        adapter={adapter}
        context={context}
        currentUsername={currentUsername}
        field={changing}
        onCancel={() => setChanging(null)}
        onUsernameChanged={(next, refreshed) => {
          const remembered = nextRememberedIdentity(readRememberedIdentity(), currentUsername, next);
          if (remembered) writeRememberedIdentity(remembered);
          setSession(refreshed ?? { ...session, displayName: next });
          setNotice(authNotice("change.userdone"));
          setChanging(null);
        }}
        session={session}
      />
    );
  }

  const changeAction = (field: ChangeField) =>
    session && adapter
      ? {
          disabled: busy,
          label: field === "username" ? AUTH_COPY.aria.changeUsername : AUTH_COPY.aria.changeEmail,
          onClick: () => startChange(field),
        }
      : undefined;

  // In Mazer the Mazer name is the one name shown, labelled "Username" (sign-in username row hidden).
  const mazerRowShown = Boolean(session && adapter && showMazerNameRow(context.id, mazerName));
  const mazerSole = mazerNameIsSoleUsername(context.id, mazerRowShown);

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
        {mazerSole ? null : (
          <AuthField
            action={changeAction("username")}
            id="account-current-username"
            label={AUTH_COPY.field.username}
            locked
            name="username"
            value={currentUsername}
          />
        )}
        {mazerRowShown ? (
          <AuthField
            action={{
              disabled: busy,
              label: mazerSole ? AUTH_COPY.aria.changeUsername : AUTH_COPY.aria.changeMazerName,
              onClick: startMazerRename,
            }}
            id="account-mazer-name"
            label={mazerSole ? AUTH_COPY.field.username : AUTH_COPY.field.mazerName}
            locked
            name="mazer-name"
            value={mazerName ?? ""}
          />
        ) : null}
        <AuthField
          action={changeAction("email")}
          id="account-current-email"
          label={AUTH_COPY.field.email}
          locked
          name="email"
          type="email"
          value={session?.email ?? ""}
        />
        {session && adapter && context.id === "mazer" ? (
          <AuthField
            action={{ disabled: busy, label: AUTH_COPY.aria.resetProgress, onClick: resetMazerProgress }}
            danger
            id="account-reset-progress-row"
            label={AUTH_COPY.field.resetProgress}
            locked
            name="reset-progress"
            value={AUTH_COPY.field.resetProgressValue}
          />
        ) : null}
        {session && adapter?.deleteAccountLive ? (
          <AuthField
            action={{ disabled: busy, label: AUTH_COPY.aria.deleteAccount, onClick: startDelete }}
            danger
            id="account-delete-row"
            label={AUTH_COPY.field.deleteAccount}
            locked
            name="delete-account"
            value={AUTH_COPY.field.deleteAccountValue}
          />
        ) : null}
        <AuthNoticeSlot
          notice={shownNotice}
          onAction={shownNotice?.id === "account.loadfail"
            ? () => window.location.reload()
            : shownNotice?.id === "account.everywhereconfirm"
              ? signOutEverywhere
              : undefined}
        />
      </div>
      <AuthLinks>
        <a href={contextualPath("/reset-password", context)}>{AUTH_COPY.link.resetPassword}</a>
        {session && adapter ? (
          <button
            data-sign-out-everywhere={confirmingEverywhere ? "confirming" : "ready"}
            disabled={busy}
            key="everywhere"
            onClick={confirmingEverywhere ? () => setConfirmingEverywhere(false) : askSignOutEverywhere}
            type="button"
          >
            {/* Both labels share one cell, the other one hidden, so the row never reflows when they swap. */}
            <span className="auth-links__swap">
              <span>{confirmingEverywhere ? AUTH_COPY.link.cancel : AUTH_COPY.link.signOutEverywhere}</span>
              <span aria-hidden="true">{confirmingEverywhere ? AUTH_COPY.link.signOutEverywhere : AUTH_COPY.link.cancel}</span>
            </span>
          </button>
        ) : null}
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock busy={busy} disabled={!session} onClick={signOut}>
        {busy ? AUTH_COPY.working.signingOut : AUTH_COPY.button.signOut}
      </AuthDock>
    </section>
  );
}

const CHANGE_FIELD_IDS: Record<"password" | ChangeField, string> = {
  email: "account-change-email",
  password: "account-change-password",
  username: "account-change-username",
};

/**
 * Change username / change email (design point 12). Step 1 re-enters the current password (checked
 * against the signed-in account, with the same security check as sign-in). Step 2 takes the new
 * value: a username is saved at once; an email gets a link at the NEW address and changes only when
 * that link is opened (`sent` keeps the address locked with a resend countdown, like sign-up).
 */
function AccountChangePanel({
  adapter,
  context,
  currentUsername,
  field,
  onCancel,
  onUsernameChanged,
  session,
}: {
  adapter: PortalAuthAdapter;
  context: AccountExperienceContext;
  currentUsername: string;
  field: ChangeField;
  onCancel: () => void;
  onUsernameChanged: (next: string, session: PortalSession | null) => void;
  session: PortalSession;
}) {
  const [step, setStep] = useState<"password" | "value" | "sent">("password");
  const [value, setValue] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useFormNotice();
  const cooldown = useCooldown();
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const pendingFocus = useRef<string | undefined>(undefined);
  const current = field === "username" ? currentUsername : session.email ?? "";

  const notice: AuthNotice | null =
    form.notice ?? (step === "password" && captchaBroken ? authNotice("captcha.load") : null);

  /** One matrix line, with the box it points at outlined and focused once the form is live again. */
  function show(id: AuthMessageId) {
    const problem: ChangeProblem = { id, fields: changeFieldsFor(id) };
    form.problem(problem);
    pendingFocus.current = problem.fields[0] ? CHANGE_FIELD_IDS[problem.fields[0]] : undefined;
  }

  /** Same, for a local check: the form never went busy, so focus now. */
  function showNow(id: AuthMessageId) {
    show(id);
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
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

  async function confirmPassword(password: string) {
    const problem = reauthProblem(password);
    if (problem) {
      showNow(problem.id);
      return;
    }
    setBusy(true);
    form.clear();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      await adapter.reauthenticate(password, captchaToken);
      setStep("value");
      pendingFocus.current = CHANGE_FIELD_IDS[field];
    } catch (error) {
      show(reauthFailure(error));
    } finally {
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  async function saveUsername() {
    const next = value.trim();
    const problem = usernameChangeProblem(next, currentUsername);
    if (problem) {
      showNow(problem.id);
      return;
    }
    setBusy(true);
    form.clear();
    try {
      const result = await adapter.changeUsername(next);
      if (result.status === "changed") {
        onUsernameChanged(next, result.session);
        return;
      }
      show(usernameChangeNotice(result.status));
    } catch (error) {
      show(usernameChangeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailLink(next: string) {
    const problem = emailChangeProblem(next, session.email);
    if (problem) {
      showNow(problem.id);
      return;
    }
    setBusy(true);
    form.clear();
    try {
      await adapter.requestEmailChange(next, context.id);
      setSentTo(next);
      setStep("sent");
      form.show("change.emailsent", next);
      cooldown.start(RESEND_SECONDS);
    } catch (error) {
      show(emailChangeFailure(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || cooldown.remaining) return;
    if (step === "password") {
      await confirmPassword(String(new FormData(event.currentTarget).get("password") ?? ""));
    } else if (field === "username") {
      await saveUsername();
    } else {
      await sendEmailLink(step === "sent" && sentTo ? sentTo : value.trim());
    }
  }

  useEffect(() => {
    if (busy || !pendingFocus.current) return;
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
  }, [busy, step]);

  const invalid = (name: "password" | ChangeField) => form.fields.has(name);
  const describedBy = (name: "password" | ChangeField) => (invalid(name) ? "auth-notice" : undefined);
  const dockLabel = step === "password"
    ? busy ? AUTH_COPY.working.checking : AUTH_COPY.button.continue
    : field === "username"
      ? busy ? AUTH_COPY.working.saving : AUTH_COPY.button.saveUsername
      : busy
        ? AUTH_COPY.working.sending
        : step === "sent" && cooldown.remaining > 0
          ? AUTH_COPY.resendIn(cooldown.remaining)
          : AUTH_COPY.button.sendLink;
  const currentLabel = field === "username" ? AUTH_COPY.field.username : AUTH_COPY.field.email;

  return (
    <section
      aria-labelledby="account-change-title"
      className="auth-surface"
      data-auth-product={context.id}
      data-auth-surface="account-change"
      data-change-field={field}
      data-change-step={step}
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead
        context={context}
        lead={step === "password"
          ? AUTH_COPY.lead.changeConfirm
          : field === "username"
            ? AUTH_COPY.lead.changeUsername
            : AUTH_COPY.lead.changeEmail}
        title={field === "username" ? AUTH_COPY.title.changeUsername : AUTH_COPY.title.changeEmail}
        titleId="account-change-title"
      />
      <form className="auth-body" id="account-change-form" noValidate onSubmit={submit}>
        {step === "sent" ? (
          <AuthField
            id={CHANGE_FIELD_IDS.email}
            label={AUTH_COPY.field.newEmail}
            locked
            name="email"
            type="email"
            value={sentTo ?? ""}
          />
        ) : (
          <AuthField
            autoComplete="username"
            id="account-change-current"
            key="current"
            label={currentLabel}
            locked
            name={field === "username" ? "current-username" : "current-email"}
            type={field === "email" ? "email" : "text"}
            value={current}
          />
        )}
        {step === "password" ? (
          <>
            <AuthField
              autoComplete="current-password"
              describedBy={describedBy("password")}
              disabled={busy}
              id={CHANGE_FIELD_IDS.password}
              invalid={invalid("password")}
              label={AUTH_COPY.field.password}
              name="password"
              onChange={() => form.edited("password")}
              secret
            />
            <TurnstileField key={captchaKey} onUnavailable={() => setCaptchaBroken(true)} ref={captchaRef} />
          </>
        ) : step === "value" ? (
          <AuthField
            autoComplete={field === "username" ? "off" : "email"}
            describedBy={describedBy(field)}
            disabled={busy}
            id={CHANGE_FIELD_IDS[field]}
            inputMode={field === "email" ? "email" : undefined}
            invalid={invalid(field)}
            label={field === "username" ? AUTH_COPY.field.newUsername : AUTH_COPY.field.newEmail}
            maxLength={field === "username" ? 15 : undefined}
            name={field}
            onChange={(next) => {
              setValue(next);
              form.edited(field);
            }}
            type={field === "email" ? "email" : "text"}
            value={value}
          />
        ) : null}
        <AuthNoticeSlot notice={notice} onAction={noticeAction} />
      </form>
      <AuthLinks>
        <button onClick={onCancel} type="button">
          {step === "sent" ? AUTH_COPY.link.backToAccount : AUTH_COPY.link.cancel}
        </button>
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock busy={busy} disabled={cooldown.remaining > 0} form="account-change-form">
        {dockLabel}
      </AuthDock>
    </section>
  );
}

const MAZER_NAME_FIELD_IDS = {
  name: "account-change-mazer-name",
  password: "account-mazer-name-password",
} as const;

/**
 * Change Mazer name (MAZER-ACCT-047). Two steps, the same security check as Change username:
 * step 1 re-enters the current password (checked against the signed-in account with the sign-in
 * security check); step 2 takes the new Mazer name and saves it at once through
 * `mazer.mazer_set_username`, which renames only the signed-in account's own Mazer profile. The
 * database decides a taken name; this page only maps the answer to a matrix line.
 */
function MazerNamePanel({
  adapter,
  context,
  currentName,
  solo,
  onCancel,
  onSaved,
}: {
  adapter: PortalAuthAdapter;
  context: AccountExperienceContext;
  currentName: string | null;
  /** True in Mazer: the Mazer name is the only name shown, labelled Username. */
  solo: boolean;
  onCancel: () => void;
  onSaved: (next: string) => void;
}) {
  const [step, setStep] = useState<"password" | "value">("password");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useFormNotice();
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const pendingFocus = useRef<string | undefined>(MAZER_NAME_FIELD_IDS.password);

  const notice: AuthNotice | null =
    form.notice ?? (step === "password" && captchaBroken ? authNotice("captcha.load") : null);

  function show(id: AuthMessageId) {
    if (id === "change.pwempty" || id === "change.pwwrong") {
      form.problem({ id, fields: ["password"] });
      pendingFocus.current = MAZER_NAME_FIELD_IDS.password;
      return;
    }
    const outlined = id === "signup.taken" || id === "signup.userinvalid" || id === "mazer.namesame";
    form.problem({ id, fields: outlined ? ["username"] : [] });
    pendingFocus.current = outlined ? MAZER_NAME_FIELD_IDS.name : undefined;
  }

  function showNow(id: AuthMessageId) {
    show(id);
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
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

  async function confirmPassword(password: string) {
    const problem = reauthProblem(password);
    if (problem) {
      showNow(problem.id);
      return;
    }
    setBusy(true);
    form.clear();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      await adapter.reauthenticate(password, captchaToken);
      setStep("value");
      pendingFocus.current = MAZER_NAME_FIELD_IDS.name;
    } catch (error) {
      show(reauthFailure(error));
    } finally {
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  async function saveName() {
    const next = value.trim();
    const problem = mazerNameProblem(next, currentName);
    if (problem) {
      showNow(problem.id);
      return;
    }
    setBusy(true);
    form.clear();
    try {
      const saved = await adapter.saveMazerName(next);
      onSaved(saved);
      return;
    } catch (error) {
      show(mazerNameFailure(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === "password") {
      await confirmPassword(String(new FormData(event.currentTarget).get("password") ?? ""));
    } else {
      await saveName();
    }
  }

  useEffect(() => {
    if (busy || !pendingFocus.current) return;
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
  }, [busy, step]);

  const passwordInvalid = form.fields.has("password");
  const nameInvalid = form.fields.has("username");
  const dockLabel = step === "password"
    ? busy ? AUTH_COPY.working.checking : AUTH_COPY.button.continue
    : busy ? AUTH_COPY.working.saving : AUTH_COPY.button.saveName;

  return (
    <section
      aria-labelledby="account-mazer-name-title"
      className="auth-surface"
      data-auth-product={context.id}
      data-auth-surface="account-mazer-name"
      data-change-step={step}
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead
        context={context}
        lead={step === "password" ? AUTH_COPY.lead.changeConfirm : AUTH_COPY.lead.changeMazerName}
        title={solo ? AUTH_COPY.title.changeUsername : AUTH_COPY.title.changeMazerName}
        titleId="account-mazer-name-title"
      />
      <form className="auth-body" id="account-mazer-name-form" noValidate onSubmit={submit}>
        <AuthField
          id="account-mazer-name-current"
          label={solo ? AUTH_COPY.field.username : AUTH_COPY.field.mazerName}
          locked
          name="current-mazer-name"
          value={currentName ?? ""}
        />
        {step === "password" ? (
          <>
            <AuthField
              autoComplete="current-password"
              describedBy={passwordInvalid ? "auth-notice" : undefined}
              disabled={busy}
              id={MAZER_NAME_FIELD_IDS.password}
              invalid={passwordInvalid}
              label={AUTH_COPY.field.password}
              name="password"
              onChange={() => form.edited("password")}
              secret
            />
            <TurnstileField key={captchaKey} onUnavailable={() => setCaptchaBroken(true)} ref={captchaRef} />
          </>
        ) : (
          <AuthField
            autoComplete="off"
            describedBy={nameInvalid ? "auth-notice" : undefined}
            disabled={busy}
            id={MAZER_NAME_FIELD_IDS.name}
            invalid={nameInvalid}
            label={solo ? AUTH_COPY.field.newUsername : AUTH_COPY.field.newMazerName}
            maxLength={15}
            name="mazer-name"
            onChange={(next) => {
              setValue(next);
              form.edited("username");
            }}
            value={value}
          />
        )}
        <AuthNoticeSlot notice={notice} onAction={noticeAction} />
      </form>
      <AuthLinks>
        <button disabled={busy} onClick={onCancel} type="button">
          {AUTH_COPY.link.cancel}
        </button>
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock busy={busy} form="account-mazer-name-form">
        {dockLabel}
      </AuthDock>
    </section>
  );
}

const DELETE_FIELD_IDS = {
  confirmation: "account-delete-confirm",
  password: "account-delete-password",
} as const;

/**
 * Delete account. Step 1 re-enters the current password (same security check as sign-in; the fresh
 * session it makes is the proof the server checks). Step 2 types the username (or the email for an
 * account without one). Step 3 says in plain words what is deleted and that it can not be undone; its
 * dock deletes. The database function decides every refusal; nothing is deleted by this page itself.
 */
function AccountDeletePanel({
  adapter,
  context,
  currentUsername,
  onCancel,
  onDeleteSettled,
  onDeleteStarting,
  session,
}: {
  adapter: PortalAuthAdapter;
  context: AccountExperienceContext;
  currentUsername: string;
  onCancel: () => void;
  onDeleteSettled: (gone: boolean) => void;
  onDeleteStarting: () => void;
  session: PortalSession;
}) {
  const [step, setStep] = useState<DeleteStep>("password");
  const [target, setTarget] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);
  const form = useFormNotice();
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const pendingFocus = useRef<string | undefined>(undefined);

  const notice: AuthNotice | null =
    form.notice ?? (step === "password" && captchaBroken ? authNotice("captcha.load") : null);

  // Leaving the screen any way ends the step-1 session.
  useEffect(() => () => void adapter.endAccountDelete(), [adapter]);

  function show(id: AuthMessageId) {
    const problem: DeleteProblem = { id, fields: deleteFieldsFor(id) };
    form.problem(problem);
    pendingFocus.current = problem.fields[0] ? DELETE_FIELD_IDS[problem.fields[0]] : undefined;
  }

  function showNow(id: AuthMessageId) {
    show(id);
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
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

  async function confirmPassword(password: string) {
    const problem = deleteReauthProblem(password);
    if (problem) {
      showNow(problem.id);
      return;
    }
    setBusy(true);
    form.clear();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      const result = await adapter.beginAccountDelete(password, captchaToken);
      setTarget(result.confirmTarget);
      setStep("type");
      pendingFocus.current = DELETE_FIELD_IDS.confirmation;
    } catch (error) {
      show(deleteReauthFailure(error));
    } finally {
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  function confirmTyped() {
    const problem = deleteConfirmProblem(typed, target);
    if (problem) {
      showNow(problem.id);
      return;
    }
    form.clear();
    setStep("warning");
  }

  async function deleteNow() {
    setBusy(true);
    form.clear();
    onDeleteStarting();
    let settled = false;
    try {
      const status = await adapter.deleteAccount(typed);
      if (isAccountGone(status)) {
        settled = true;
        setGone(true);
        onDeleteSettled(true);
        return;
      }
      const next = accountDeleteNotice(status);
      setStep(next.step);
      if (next.step === "password") setTarget("");
      if (next.id) show(next.id);
    } catch (error) {
      show(accountDeleteFailure(error));
    } finally {
      if (!settled) {
        onDeleteSettled(false);
        setBusy(false);
      }
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || gone) return;
    if (step === "password") {
      await confirmPassword(String(new FormData(event.currentTarget).get("password") ?? ""));
    } else if (step === "type") {
      confirmTyped();
    } else {
      await deleteNow();
    }
  }

  useEffect(() => {
    if (busy || !pendingFocus.current) return;
    focusField(pendingFocus.current);
    pendingFocus.current = undefined;
  }, [busy, step]);

  const refused = notice?.id === "delete.billing" || notice?.id === "delete.support";
  const invalid = (name: "password" | "confirmation") => form.fields.has(name);
  const describedBy = (name: "password" | "confirmation") => (invalid(name) ? "auth-notice" : undefined);
  const dockLabel = step === "warning"
    ? busy || gone ? AUTH_COPY.working.deleting : AUTH_COPY.button.deleteAccount
    : busy ? AUTH_COPY.working.checking : AUTH_COPY.button.continue;

  return (
    <section
      aria-labelledby="account-delete-title"
      className="auth-surface"
      data-auth-product={context.id}
      data-auth-surface="account-delete"
      data-delete-step={step}
      style={authAccentStyle(context)}
    >
      <RuntimeNote />
      <AuthHead
        context={context}
        lead={step === "password"
          ? AUTH_COPY.lead.changeConfirm
          : step === "type"
            ? AUTH_COPY.lead.deleteType
            : AUTH_COPY.lead.deleteWarning}
        title={AUTH_COPY.title.deleteAccount}
        titleId="account-delete-title"
      />
      <form className="auth-body" id="account-delete-form" noValidate onSubmit={submit}>
        {step === "password" ? (
          <>
            <AuthField
              autoComplete="username"
              id="account-delete-current"
              label={AUTH_COPY.field.username}
              locked
              name="current-username"
              value={currentUsername || session.email || ""}
            />
            <AuthField
              autoComplete="current-password"
              describedBy={describedBy("password")}
              disabled={busy}
              id={DELETE_FIELD_IDS.password}
              invalid={invalid("password")}
              label={AUTH_COPY.field.password}
              name="password"
              onChange={() => form.edited("password")}
              secret
            />
            <TurnstileField key={captchaKey} onUnavailable={() => setCaptchaBroken(true)} ref={captchaRef} />
          </>
        ) : step === "type" ? (
          <AuthField
            autoComplete="off"
            describedBy={describedBy("confirmation")}
            disabled={busy}
            id={DELETE_FIELD_IDS.confirmation}
            invalid={invalid("confirmation")}
            label={AUTH_COPY.field.typeToConfirm(target)}
            name="delete-confirm"
            onChange={(next) => {
              setTyped(next);
              form.edited("confirmation");
            }}
            value={typed}
          />
        ) : (
          <ul className="auth-delete-list">
            {AUTH_COPY.deleteList.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <AuthNoticeSlot notice={notice} onAction={noticeAction} />
      </form>
      <AuthLinks>
        <button disabled={busy || gone} onClick={onCancel} type="button">
          {AUTH_COPY.link.cancel}
        </button>
      </AuthLinks>
      <AuthLegal context={context} />
      {refused ? (
        // A refusal (purchase, support-only account) cannot be retried: no destructive button, just a way back.
        <AuthDock onClick={onCancel}>{AUTH_COPY.link.backToAccount}</AuthDock>
      ) : (
        <AuthDock busy={busy || gone} danger={step === "warning"} form="account-delete-form">
          {dockLabel}
        </AuthDock>
      )}
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
  const [linkNoticeDismissed, setLinkNoticeDismissed] = useState(false);
  const cooldown = useCooldown();
  const captchaRef = useRef<TurnstileFieldHandle>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [captchaBroken, setCaptchaBroken] = useState(false);
  // The resend minute is counting down (after a send, a refused send, or restored after a reload).
  const [resendWait, setResendWait] = useState(false);
  const recoveryState = useRecoverySession(hydrated, recovery, resolution);
  // A recovery link the confirm route could not use lands here with `?link=expired|invalid`.
  const linkFailureNotice = hydrated && !recovery
    ? resetLinkNotice(new URLSearchParams(window.location.search).get(RESET_LINK_PARAM))
    : null;
  // A dead link (invalid, expired, or the exchange failed) lands on the request form with the reason.
  const recoveryLinkDead = recovery && (
    recoveryState === "invalid" ||
    recoveryState === "expired" ||
    recoveryState === "recoverable-error"
  );
  const newPassword = recovery && !recoveryLinkDead;
  const recoveryReady = newPassword && recoveryState === "ready";
  const signedInEmail = useSignedInEmail(adapter, hydrated && !newPassword);
  // The recovery session's own address, once the link is accepted (hidden username for autofill).
  const recoveryEmail = useSignedInEmail(adapter, recoveryReady);
  const internalMazerReturn = useInternalMazerReturn(context);
  // Design direction #9: signed out, the request takes a USERNAME, never a typed email (once the
  // server side is live; see RESET_BY_USERNAME_LIVE). Signed in, the account's address stays locked.
  const resetByUsername = !signedInEmail && (adapter ? adapter.resetByUsername : RESET_BY_USERNAME_LIVE);

  const linkNotice: AuthMessageId | null = linkNoticeDismissed
    ? null
    : !recovery
      ? linkFailureNotice
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

  const waitChecked = useRef(false);
  useEffect(() => {
    // Once, when the request form first appears (deferred like useRecoverySession; a re-render
    // before the timer fires reschedules it, the ref keeps it to one run).
    if (!hydrated || recovery || waitChecked.current) return;
    const timer = window.setTimeout(() => {
      if (waitChecked.current) return;
      waitChecked.current = true;
      const remaining = resetWaitRemaining(browserLocalStorage(), Date.now());
      if (remaining <= 0) return;
      setResendWait(true);
      cooldown.start(remaining);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cooldown, hydrated, recovery]);

  function linkSent() {
    recordResetSent(browserLocalStorage(), Date.now());
    setResendWait(true);
    cooldown.start(RESET_RESEND_SECONDS);
  }

  function clearAll() {
    form.clear();
    setLinkNoticeDismissed(true);
  }

  function edited(field: FieldName) {
    form.edited(field);
    setLinkNoticeDismissed(true);
    setResendWait(false);
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

  async function requestLinkByUsername() {
    if (!adapter) return;
    const username = (document.getElementById("account-reset-username") as HTMLInputElement | null)?.value.trim() ?? "";
    const problem = resetUsernameProblem(username);
    if (problem) {
      form.problem(problem);
      setLinkNoticeDismissed(true);
      focusField("account-reset-username");
      return;
    }
    setBusy(true);
    clearAll();
    cooldown.start();
    try {
      const captchaToken = await captchaRef.current?.getToken();
      await adapter.requestPasswordResetByUsername(username, context.id, internalMazerReturn, captchaToken);
      // One fixed line for every username: the server never says whether it has an account, and no
      // address (masked or not) is ever shown here.
      form.show("reset.sentuser");
      linkSent();
    } catch (error) {
      form.show(usernameResetFailure(error));
    } finally {
      captchaRef.current?.reset();
      setBusy(false);
    }
  }

  async function requestLink() {
    if (!adapter) return;
    if (resetByUsername) {
      await requestLinkByUsername();
      return;
    }
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
      // Signed in, the address is already on screen; signed out, the answer must not reveal whether
      // an account uses the typed address.
      if (signedInEmail) form.show("reset.sent", signedInEmail);
      else form.show("reset.sentany");
      linkSent();
    } catch (error) {
      const id = resetRequestFailure(error);
      form.show(id);
      // The provider refused to send: count down the same minute it waits, and say nothing was sent.
      if (id === "reset.wait") {
        setResendWait(true);
        cooldown.start(RESET_RESEND_SECONDS);
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
      : resendWait && cooldown.remaining > 0
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
            {recoveryEmail ? (
              // Not shown: tells password managers which saved account the new password belongs to.
              <input
                autoComplete="username"
                hidden
                id="account-recovery-username"
                name="username"
                readOnly
                type="email"
                value={recoveryEmail}
              />
            ) : null}
            <AuthField
              autoComplete="new-password"
              describedBy={describedBy("password")}
              disabled={!recoveryReady || busy}
              id="account-new-password"
              invalid={invalid("password")}
              label={AUTH_COPY.field.newPassword}
              name="password"
              newPasswordMinimum={PASSWORD_MINIMUM}
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
              newPasswordMinimum={PASSWORD_MINIMUM}
              onChange={() => edited("confirmation")}
              secret
            />
          </>
        ) : signedInEmail ? (
          <AuthField
            autoComplete="username"
            id="account-reset-email"
            label={AUTH_COPY.field.email}
            locked
            name="email"
            type="email"
            value={signedInEmail}
          />
        ) : resetByUsername ? (
          <AuthField
            autoComplete="username"
            describedBy={describedBy("username")}
            disabled={signedInEmail === undefined && Boolean(adapter)}
            id="account-reset-username"
            invalid={invalid("username")}
            label={AUTH_COPY.field.username}
            maxLength={15}
            name="username"
            onChange={() => edited("username")}
          />
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
        // Read before the address is scrubbed; only the exact Mazer authorization path survives.
        const rawReturnTo = url.searchParams.get("returnTo");
        sanitizeAuthUrl();
        if (!payload) {
          toLogin("callback", "invalid");
          return;
        }
        if (payload.type === "recovery") {
          // Recovery link (any browser): the provider checks the one-time token (verifyOtp) and
          // answers with the recovery session, no PKCE verifier needed. Then the new-password form,
          // or the request form with the reason. Destinations are built from constants
          // (recoveryLandingPath), never from the link.
          const toReset = (failure?: "expired" | "invalid") =>
            leave(recoveryLandingPath(context.id, rawReturnTo, failure), failure ? `recovery-${failure}` : "recovery");
          if (!adapter) {
            toLogin("unavailable", "unavailable");
            return;
          }
          adapter
            .confirm(payload.tokenHash, payload.type)
            .then((session) => toReset(session ? undefined : "expired"))
            .catch((error: unknown) => toReset(recoveryLinkFailure(error)));
          return;
        }
        if (payload.type === "email_change") {
          // An email change always lands on the account page with its outcome: done (the provider
          // returned a session), one more link to open (secure email change), or a dead link. The
          // one-time token is the proof; there is no product handoff and no confirmation state.
          if (!adapter) {
            toLogin("unavailable", "unavailable");
            return;
          }
          // Built from constants and an allowlisted notice key, never from the link (like toLogin).
          const toAccount = (outcome: "session" | "no-session" | "error") =>
            leave(
              contextualPath(`/account?${ACCOUNT_NOTICE_PARAM}=${emailChangeLandingKey(outcome)}`, context),
              `email-change-${outcome}`,
            );
          adapter
            .confirm(payload.tokenHash, payload.type)
            .then((session) => toAccount(session ? "session" : "no-session"))
            .catch(() => toAccount("error"));
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
        <AuthNoticeSlot notice={authNotice(state === "error" ? "account.signoutfail" : "signout.unavailable")} />
      </div>
      <AuthLinks>
        <a href={contextualPath("/login", context)}>{AUTH_COPY.link.signIn}</a>
      </AuthLinks>
      <AuthLegal context={context} />
      <AuthDock
        onClick={() => {
          // Unavailable means the account service did not resolve; only a fresh load can ask again.
          if (state === "unavailable") {
            window.location.reload();
            return;
          }
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
