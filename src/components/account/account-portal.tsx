"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  accountContract,
  classifyRuntimeOrigin,
  resolveAccountExperienceContext,
  type AccountExperienceContext,
} from "@/config/account";
import {
  sanitizeContextReturnTarget,
  sanitizeReturnTarget,
} from "@/config/account-return";
import { productIdentity } from "@/config/product";
import {
  callbackReceiptKey,
  callbackStateMatches,
  parseCallbackPayload,
  parseConfirmPayload,
  parseRecoveryPayload,
  sanitizeAuthUrl,
  sanitizeRecoveryUrl,
} from "@/lib/auth/callback-contract";
import {
  scheduleCooldownTicks,
  scheduleDeferredAttempt,
  type OneShotAttemptState,
} from "@/lib/auth/client-lifecycle";
import { safeAuthError, safeAuthSuccess } from "@/lib/auth/errors";
import {
  resolvePortalAuthAdapter,
  type AdapterResolution,
  type PortalAuthAdapter,
  type PortalSession,
} from "@/lib/auth/browser-adapter";
import { PASSWORD_MINIMUM, validatePassword } from "@/lib/auth/password-policy";
import {
  SystemState,
  type SystemStateVariant,
} from "@/components/system/system-state";

type PortalMode = "login" | "account" | "confirm" | "callback" | "reset";

type Notice = {
  kind: "error" | "info" | "success";
  text: string;
  variant?: SystemStateVariant;
};

const emptySubscribe = () => () => undefined;
const SIGNUP_SETTLEMENT_MINIMUM_MS = 500;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,15}$/;

async function settleSignupAttempt(
  adapter: PortalAuthAdapter,
  email: string,
  password: string,
  username: string,
  context: AccountExperienceContext,
) {
  const [result] = await Promise.allSettled([
    adapter.signUp(email, password, username, context.id),
    new Promise((resolve) => window.setTimeout(resolve, SIGNUP_SETTLEMENT_MINIMUM_MS)),
  ]);
  return result.status === "fulfilled" ? result.value : null;
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

function useCooldown(seconds = 5) {
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
    start() {
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
    show(nextNotice: Notice) {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      setNotice(nextNotice);
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setNotice(null);
      }, duration);
    },
  };
}

function contextualPath(path: string, context: AccountExperienceContext) {
  if (context.id === "website") return path;
  const url = new URL(path, accountContract.canonicalOrigin);
  url.searchParams.set("app", context.id);
  return `${url.pathname}${url.search}`;
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

function AccountTextDivider() {
  return (
    <span aria-hidden="true" className="account-link-separator">
      <span />
    </span>
  );
}

function AccountLegalLinks({ context }: { context: AccountExperienceContext }) {
  if (context.legalLinks.length === 0) return null;
  return (
    <div aria-label={`${context.productName} legal`} className="account-auth-legal">
      {context.legalLinks.map((link, index) => (
        <Fragment key={link.href}>
          {index > 0 ? <AccountTextDivider /> : null}
          <a href={link.href}>{link.label}</a>
        </Fragment>
      ))}
    </div>
  );
}

function SetupState({ resolution }: { resolution: AdapterResolution | null }) {
  if (!resolution) {
    return <p className="account-capability-note" role="status">Preparing account service.</p>;
  }
  if (resolution.status === "ready") return null;

  return <p className="account-capability-note" role="status">Account service unavailable on this origin.</p>;
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
      return "Action complete.";
    case "invalid":
      return "This action is invalid.";
    case "expired":
      return "This action has expired.";
    case "unauthorized":
      return "This action is not authorized.";
    case "unavailable":
      return "This service is unavailable.";
    case "terminal-error":
      return "This action cannot continue.";
    case "recoverable-error":
      return "This action needs another try.";
    default:
      return "Working on this action.";
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
  const [intent, setIntent] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
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
    setIntent(intent === "login" ? "signup" : "login");
    transient.clear();
    setInvalidFields(new Set());
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || cooldown.remaining) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const submittedUsername = String(form.get("username") ?? "").trim();
    const nextInvalidFields = new Set<string>();
    if (!email || (intent === "signup" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      nextInvalidFields.add("email");
    }
    if (intent === "signup" && !USERNAME_PATTERN.test(submittedUsername)) {
      nextInvalidFields.add("username");
    }
    const validation = validatePassword(password, intent);
    if (!validation.valid) nextInvalidFields.add("password");
    if (nextInvalidFields.size > 0) {
      setInvalidFields(nextInvalidFields);
      return;
    }

    setBusy(true);
    transient.clear();
    setInvalidFields(new Set());
    cooldown.start();
    try {
      if (intent === "signup") {
        // The adapter persists and publishes a real returned session. The notice intentionally
        // makes no claim about whether the provider created an account or returned a session.
        const session = await settleSignupAttempt(
          adapter,
          email,
          password,
          submittedUsername,
          context,
        );
        if (session) {
          const identity = session.displayName || submittedUsername;
          writeRememberedIdentity(identity);
          setRememberedIdentity(identity);
        }
        transient.show({ kind: "success", text: safeAuthSuccess("signup") });
        return;
      }

      const session = await adapter.signIn(email, password);
      if (session) {
        const identity = session.displayName || deriveIdentity(email);
        writeRememberedIdentity(identity);
        setRememberedIdentity(identity);
      }
      transient.show(
        session
          ? { kind: "success", text: "Signed in on this account origin." }
          : { kind: "error", text: safeAuthError("login") },
      );
      if (session) {
        const destinationUrl = new URL(
          sanitizeContextReturnTarget(
            new URLSearchParams(window.location.search).get("returnTo"),
            context,
          ),
        );
        if (context.id === "website") destinationUrl.searchParams.set("signedIn", "1");
        const destination = destinationUrl.href;
        if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
          document.documentElement.dataset.postAuthDestination = destination;
        } else {
          window.location.assign(destination);
        }
      }
    } catch {
      transient.show({ kind: "error", text: safeAuthError(intent) });
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
          {intent === "login" ? "Welcome" : "Create account"}
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
        <form className="account-form account-form--auth" id="account-auth-form" noValidate onSubmit={submit}>
        {intent === "signup" ? (
          <fieldset data-invalid={invalidFields.has("username") || undefined}>
            <legend><label htmlFor="account-username">Username</label></legend>
            <input
              aria-invalid={invalidFields.has("username") || undefined}
              id="account-username"
              autoComplete="username"
              maxLength={15}
              minLength={2}
              name="username"
              onChange={(event) => {
                setUsername(event.target.value);
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
        <fieldset data-invalid={invalidFields.has("email") || undefined}>
          <legend><label htmlFor="account-email">{intent === "login" ? "Email or username" : "Email"}</label></legend>
          <input
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
            {intent === "login" ? "Create account" : "Log in"}
          </button>
          {intent === "login" ? (
            <>
              <AccountTextDivider />
              <a href={contextualPath("/reset-password", context)}>Reset password</a>
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
            : transient.notice
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
    const unsubscribe = adapter.onSessionChange((next) => {
      if (active) setSession(next);
    });
    adapter
      .getSession()
      .then((next) => {
        if (active) setSession(next);
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

  useEffect(() => {
    if (adapter && loaded && !session && !error) {
      window.location.replace(contextualPath("/login", context));
    }
  }, [adapter, context, error, loaded, session]);

  async function signOut() {
    if (!adapter) return;
    setBusy(true);
    setNotice(null);
    try {
      await adapter.signOut();
      if (classifyRuntimeOrigin(window.location.origin) === "local-test") {
        window.location.assign(contextualPath("/login", context));
        return;
      }
      const destination = new URL("/", context.destinationOrigin);
      if (context.id === "website") destination.searchParams.set("signedOut", "1");
      window.location.assign(destination.href);
    } catch {
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
          <a href={contextualPath("/reset-password", context)}>Reset password</a>
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
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const cooldown = useCooldown();
  const recoveryState = useRecoverySession(hydrated, recovery, resolution);
  const recoveryReady = recovery && recoveryState === "ready";

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
    const nextInvalidFields = new Set<string>();

    if (recovery) {
      const password = String(form.get("password") ?? "");
      const confirmation = String(form.get("confirmation") ?? "");
      const validation = validatePassword(password, "reset");
      if (!validation.valid) nextInvalidFields.add("password");
      if (!confirmation || password !== confirmation) nextInvalidFields.add("confirmation");
      if (nextInvalidFields.size > 0) {
        setInvalidFields(nextInvalidFields);
        return;
      }
      setBusy(true);
      transient.clear();
      setInvalidFields(new Set());
      cooldown.start();
      try {
        await adapter.updatePassword(password);
        await adapter.signOut();
        formElement.reset();
        transient.show({ kind: "success", text: safeAuthSuccess("reset-complete") });
        window.setTimeout(() => {
          window.location.replace(contextualPath("/login", context));
        }, 700);
      } catch {
        transient.show({ kind: "error", text: safeAuthError("reset-complete") });
      } finally {
        setBusy(false);
      }
      return;
    }

    const email = String(form.get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInvalidFields(new Set(["email"]));
      return;
    }
    setBusy(true);
    transient.clear();
    setInvalidFields(new Set());
    cooldown.start();
    try {
      await adapter.requestPasswordReset(email, context.id);
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
        <h1 id="reset-panel-title">{recovery ? "New password" : "Reset password"}</h1>
      </header>
      <div className="account-auth-body">
        <SetupState resolution={resolution} />
        <AuthLiveNotice notice={actionNotice} />
        {!recovery || recoveryReady ? (
          <form className="account-form account-form--auth" id="account-reset-form" noValidate onSubmit={submit}>
        {recovery ? (
          <>
            <fieldset data-invalid={invalidFields.has("password") || undefined}>
              <legend><label htmlFor="account-new-password">New password</label></legend>
              <input
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
            <input aria-invalid={invalidFields.has("email") || undefined} autoComplete="email" id="account-reset-email" inputMode="email" name="email" onChange={() => setInvalidFields(new Set())} required type="email" />
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
          <a href={contextualPath("/login", context)}>Log in</a>
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
    text: mode === "confirm" ? "Checking this confirmation link…" : "Checking this sign-in handoff…",
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
            text: "This confirmation address is missing valid one-time details. Request a fresh link.",
            variant: "invalid",
          });
          return;
        }
        setReturnTo(payload.returnTo);
        if (!adapter) {
          setNotice({
            kind: "info",
            text: "Confirmation is ready, but account setup is pending.",
            variant: "unavailable",
          });
          return;
        }
        adapter
          .confirm(payload.tokenHash, payload.type)
          .then(() => setNotice({ kind: "success", text: "Confirmation complete." }))
          .catch(() => setNotice({ kind: "error", text: safeAuthError("confirm") }));
        return;
      }

      const payload = parseCallbackPayload(url);
      sanitizeAuthUrl();
      if (!payload) {
        setNotice({
          kind: "error",
          text: "This sign-in address is missing a valid authorization handoff. Start again.",
          variant: "invalid",
        });
        return;
      }
      setReturnTo(payload.returnTo);
      const receipt = callbackReceiptKey(payload.code);
      if (window.sessionStorage.getItem(receipt) === "complete") {
        setNotice({ kind: "success", text: "This sign-in handoff was already completed." });
        scheduleRedirect(payload.returnTo);
        return;
      }
      const storedState = window.sessionStorage.getItem(accountContract.callbackStateKey);
      if (!callbackStateMatches(payload.state, storedState)) {
        setNotice({
          kind: "error",
          text: "This sign-in handoff does not match the browser that started it. Start again.",
          variant: "unauthorized",
        });
        return;
      }
      if (!adapter) {
        setNotice({
          kind: "info",
          text: "The handoff is valid, but account setup is pending.",
          variant: "unavailable",
        });
        return;
      }
      adapter
        .exchangeCode(payload.code)
        .then(() => {
          window.sessionStorage.setItem(receipt, "complete");
          window.sessionStorage.removeItem(accountContract.callbackStateKey);
          setNotice({ kind: "success", text: "Sign-in handoff complete." });
          scheduleRedirect(payload.returnTo);
        })
        .catch(() => setNotice({ kind: "error", text: safeAuthError("callback") }));
    });

    return () => {
      cancelAttempt();
      if (redirectTimer.current !== null) {
        window.clearTimeout(redirectTimer.current);
        redirectTimer.current = null;
      }
    };
  }, [adapter, hydrated, mode]);

  const variant = noticeVariant(notice);
  const title =
    variant === "pending"
      ? "Checking your link."
      : variant === "success"
        ? "You are all set."
        : variant === "invalid"
          ? "This link is invalid."
          : variant === "unauthorized"
            ? "This handoff does not match."
            : variant === "unavailable"
              ? "Account setup is not connected here."
              : variant === "expired"
                ? "This link has expired."
                : "This link needs a fresh start.";
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
          <p>
            One-time details are processed once, removed from the address bar, and allowed to
            continue only to an approved {productIdentity.publicName} destination.
          </p>
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
