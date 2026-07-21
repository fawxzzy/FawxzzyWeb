"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  accountContract,
  classifyRuntimeOrigin,
  sanitizeReturnTarget,
} from "@/config/account";
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
import { safeAuthError, safeAuthSuccess, type AuthAction } from "@/lib/auth/errors";
import {
  resolvePortalAuthAdapter,
  type AdapterResolution,
  type PortalAuthAdapter,
  type PortalSession,
} from "@/lib/auth/browser-adapter";
import { PASSWORD_MINIMUM, validatePassword } from "@/lib/auth/password-policy";
import {
  normalizeServiceRegistrationReadModel,
  resolveServiceRegistrationPresentation,
  serviceDispositionCopy,
  serviceDispositionLabel,
} from "@/lib/account/service-registration";

type PortalMode = "login" | "account" | "confirm" | "callback" | "reset";

type Notice = {
  kind: "error" | "info" | "success";
  text: string;
};

const emptySubscribe = () => () => undefined;
const SIGNUP_SETTLEMENT_MINIMUM_MS = 500;

async function settleSignupAttempt(
  adapter: PortalAuthAdapter,
  email: string,
  password: string,
) {
  await Promise.allSettled([
    adapter.signUp(email, password),
    new Promise((resolve) => window.setTimeout(resolve, SIGNUP_SETTLEMENT_MINIMUM_MS)),
  ]);
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

function useServiceRegistrationPresentation() {
  const hydrated = useHydrated();
  return useMemo(
    () =>
      hydrated
        ? resolveServiceRegistrationPresentation(window.location)
        : normalizeServiceRegistrationReadModel(null),
    [hydrated],
  );
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

function SetupState({ resolution }: { resolution: AdapterResolution | null }) {
  if (!resolution) {
    return (
      <div aria-live="polite" className="account-notice account-notice--info">
        Loading the account surface…
      </div>
    );
  }
  if (resolution.status === "ready") return null;

  return (
    <div
      aria-live="polite"
      className="account-notice account-notice--info"
      data-auth-state="setup-pending"
      role="status"
    >
      <strong>Account setup is pending.</strong>
      <span>{resolution.reason} No credentials or account data were sent.</span>
    </div>
  );
}

function RuntimeNote() {
  const hydrated = useHydrated();
  if (!hydrated) return null;

  const kind = classifyRuntimeOrigin(window.location.origin);
  if (kind === "account") return null;

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

function StatusNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div
      aria-live="polite"
      className={`account-notice account-notice--${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      {notice.text}
    </div>
  );
}

function adapterFrom(resolution: AdapterResolution | null): PortalAuthAdapter | null {
  return resolution?.status === "ready" ? resolution.adapter : null;
}

function LoginPanel({ resolution }: { resolution: AdapterResolution | null }) {
  const [intent, setIntent] = useState<"login" | "signup">("login");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();
  const adapter = adapterFrom(resolution);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || cooldown.remaining) return;

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const validation = validatePassword(password, intent);
    if (!validation.valid) {
      setNotice({ kind: "error", text: validation.message });
      return;
    }

    setBusy(true);
    setNotice(null);
    cooldown.start();
    try {
      if (intent === "signup") {
        // The adapter persists and publishes a real returned session. The notice intentionally
        // makes no claim about whether the provider created an account or returned a session.
        await settleSignupAttempt(adapter, email, password);
        setNotice({ kind: "success", text: safeAuthSuccess("signup") });
        return;
      }

      const session = await adapter.signIn(email, password);
      setNotice(
        session
          ? { kind: "success", text: "Signed in on this account origin." }
          : { kind: "error", text: safeAuthError("login") },
      );
    } catch {
      setNotice({ kind: "error", text: safeAuthError(intent) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="login-panel-title" className="account-card surface-panel">
      <RuntimeNote />
      <div aria-label="Account action" className="account-segmented" role="group">
        <button
          aria-pressed={intent === "login"}
          onClick={() => {
            setIntent("login");
            setNotice(null);
          }}
          type="button"
        >
          Sign in
        </button>
        <button
          aria-pressed={intent === "signup"}
          onClick={() => {
            setIntent("signup");
            setNotice(null);
          }}
          type="button"
        >
          Create account
        </button>
      </div>
      <div className="account-card__heading">
        <p className="field-label">Email + password</p>
        <h2 id="login-panel-title">
          {intent === "login" ? "Welcome back." : "Make one Fawxzzy account."}
        </h2>
        <p>
          {intent === "login"
            ? "Sign in with your existing credentials. Legacy shorter passwords still work here."
            : `Use ${PASSWORD_MINIMUM} or more characters. We never trim or truncate your password.`}
        </p>
      </div>
      <SetupState resolution={resolution} />
      <StatusNotice notice={notice} />
      <form className="account-form" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input autoComplete="email" inputMode="email" name="email" required type="email" />
        </label>
        <label>
          <span>Password</span>
          <input
            autoComplete={intent === "login" ? "current-password" : "new-password"}
            minLength={intent === "signup" ? PASSWORD_MINIMUM : undefined}
            name="password"
            required
            type="password"
          />
        </label>
        <button
          className="catalog-button catalog-button--primary"
          disabled={!adapter || busy || cooldown.remaining > 0}
          type="submit"
        >
          {busy
            ? "Working…"
            : cooldown.remaining
              ? `Try again in ${cooldown.remaining}s`
              : intent === "login"
                ? "Sign in"
                : "Create account"}
        </button>
      </form>
      <div className="account-card__links">
        <a href="/reset-password">Forgot password?</a>
        <a href="/account">View account status</a>
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

function ServiceRegistrationPanel() {
  const snapshot = useServiceRegistrationPresentation();

  return (
    <div
      aria-labelledby="shared-services-title"
      className="account-settings"
      data-service-capability={snapshot.capability}
    >
      <div className="account-card__heading">
        <p className="field-label">Shared identity services</p>
        <h2 id="shared-services-title">One identity. Explicit service state.</h2>
        <p>
          Fitness and Mazer are human-account services. When the authoritative platform
          capability is enabled, signing into a service can idempotently create or activate its
          service account. This page never treats local state as proof.
        </p>
      </div>
      {snapshot.services.map((service) => (
        <div
          className="account-capability"
          data-service-disposition={service.disposition}
          data-service-id={service.id}
          key={service.id}
        >
          <div>
            <p className="field-label">
              {service.name} · Service available · Registration {serviceDispositionLabel(service.disposition)}
            </p>
            <h3>{serviceDispositionLabel(service.disposition)}</h3>
            <p>{serviceDispositionCopy(service.disposition)}</p>
            <p>{service.summary}</p>
            <div className="account-card__links">
              <a href={service.currentDestination} rel="noreferrer">
                Open current {service.name}
              </a>
              <span data-service-canonical={service.canonicalDestination}>
                Canonical home: {new URL(service.canonicalDestination).hostname}
              </span>
            </div>
          </div>
          <button
            className="catalog-button catalog-button--disabled"
            data-service-activation="gated"
            disabled
            type="button"
          >
            {service.disposition === "active"
              ? "Active via platform readback"
              : "Activation not connected"}
          </button>
        </div>
      ))}
    </div>
  );
}

function AccountPanel({ resolution }: { resolution: AdapterResolution | null }) {
  const adapter = adapterFrom(resolution);
  const { error, loaded, session, setSession } = usePortalSession(adapter);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyAction, setBusyAction] = useState<AuthAction | null>(null);

  async function updateEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || !session?.email) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const currentPassword = String(form.get("current-password") ?? "");
    setBusyAction("update-email");
    setNotice(null);
    try {
      const reauthenticated = await adapter.signIn(session.email, currentPassword);
      if (reauthenticated?.userId !== session.userId) throw new Error("Reauthentication failed.");
      await adapter.updateEmail(email);
      setSession({ ...session, email });
      setNotice({ kind: "success", text: safeAuthSuccess("update-email") });
    } catch {
      setNotice({ kind: "error", text: safeAuthError("update-email") });
    } finally {
      setBusyAction(null);
    }
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || !session?.email) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("current-password") ?? "");
    const password = String(form.get("password") ?? "");
    const validation = validatePassword(password, "change");
    if (!validation.valid) {
      setNotice({ kind: "error", text: validation.message });
      return;
    }
    setBusyAction("update-password");
    setNotice(null);
    try {
      const reauthenticated = await adapter.signIn(session.email, currentPassword);
      if (reauthenticated?.userId !== session.userId) throw new Error("Reauthentication failed.");
      await adapter.updatePassword(password);
      formElement.reset();
      setNotice({ kind: "success", text: safeAuthSuccess("update-password") });
    } catch {
      setNotice({ kind: "error", text: safeAuthError("update-password") });
    } finally {
      setBusyAction(null);
    }
  }

  async function signOut() {
    if (!adapter) return;
    setBusyAction("signout");
    setNotice(null);
    try {
      await adapter.signOut();
      setSession(null);
      setNotice({ kind: "success", text: safeAuthSuccess("signout") });
    } catch {
      setNotice({ kind: "error", text: safeAuthError("signout") });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section aria-labelledby="account-status-title" className="account-card surface-panel">
      <RuntimeNote />
      <div className="account-card__heading">
        <p className="field-label">Origin-scoped session</p>
        <h2 id="account-status-title">Your account, on this origin.</h2>
        <p>
          Phase one shares credentials across products, not browser sessions. No parent-domain
          cookie or refresh token is shared.
        </p>
      </div>
      <SetupState resolution={resolution} />
      {error ? <StatusNotice notice={{ kind: "error", text: safeAuthError("session") }} /> : null}
      <StatusNotice notice={notice} />
      {adapter && loaded && !session ? (
        <div className="account-empty-state">
          <p>You are not signed in on this origin.</p>
          <a className="catalog-button catalog-button--primary" href="/login">
            Sign in
          </a>
        </div>
      ) : null}
      {session ? (
        <div className="account-settings">
          <div className="account-session-row">
            <div>
              <span className="field-label">Signed in as</span>
              <strong>{session.email ?? "Email unavailable"}</strong>
            </div>
            <button
              className="catalog-button catalog-button--secondary"
              disabled={busyAction !== null}
              onClick={signOut}
              type="button"
            >
              Sign out here
            </button>
          </div>
          <form className="account-form account-form--compact" onSubmit={updateEmail}>
            <label>
              <span>Update email</span>
              <input
                autoComplete="email"
                defaultValue={session.email ?? ""}
                inputMode="email"
                name="email"
                required
                type="email"
              />
            </label>
            <label>
              <span>Current password</span>
              <input
                autoComplete="current-password"
                name="current-password"
                required
                type="password"
              />
            </label>
            <button
              className="catalog-button catalog-button--secondary"
              disabled={busyAction !== null}
              type="submit"
            >
              Save email
            </button>
          </form>
          <form className="account-form account-form--compact" onSubmit={updatePassword}>
            <label>
              <span>Current password</span>
              <input
                autoComplete="current-password"
                name="current-password"
                required
                type="password"
              />
            </label>
            <label>
              <span>New password</span>
              <input
                autoComplete="new-password"
                minLength={PASSWORD_MINIMUM}
                name="password"
                required
                type="password"
              />
            </label>
            <button
              className="catalog-button catalog-button--secondary"
              disabled={busyAction !== null}
              type="submit"
            >
              Save password
            </button>
          </form>
        </div>
      ) : null}
      <ServiceRegistrationPanel />
      <div className="account-capability" data-username-capability="gated">
        <div>
          <p className="field-label">Canonical global username</p>
          <h3>Reserved for the governed profile contract.</h3>
          <p>
            Username reads, availability, and writes stay disabled until the platform schema and
            capability are deployed. No availability is guessed here.
          </p>
        </div>
        <button className="catalog-button catalog-button--disabled" disabled type="button">
          Not connected yet
        </button>
      </div>
      <div className="account-capability" data-user-number-capability="gated">
        <div>
          <p className="field-label">Immutable global user number</p>
          <h3>Authoritative readback only.</h3>
          <p>
            The central allocator owns unique, never-reused human user numbers. This client does
            not allocate, infer, or renumber them while the platform capability is unavailable.
          </p>
          <span data-user-number-state="unavailable">User number unavailable</span>
        </div>
        <button className="catalog-button catalog-button--disabled" disabled type="button">
          Platform-gated
        </button>
      </div>
    </section>
  );
}

type RecoverySessionState = "error" | "idle" | "pending" | "ready" | "setup-pending";

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
        if (active) setState("error");
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
          if (active) setState(session ? "ready" : "error");
        })
        .catch(() => {
          if (active) setState("error");
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [hydrated, recovery, resolution]);

  return state;
}

function ResetPanel({ resolution }: { resolution: AdapterResolution | null }) {
  const hydrated = useHydrated();
  const recovery = hydrated
    ? new URLSearchParams(window.location.search).get("recovery") === "1"
    : false;
  const adapter = adapterFrom(resolution);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();
  const recoveryState = useRecoverySession(hydrated, recovery, resolution);
  const recoveryReady = recovery && recoveryState === "ready";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || busy || cooldown.remaining || (recovery && !recoveryReady)) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setNotice(null);

    if (recovery) {
      const password = String(form.get("password") ?? "");
      const confirmation = String(form.get("confirmation") ?? "");
      const validation = validatePassword(password, "reset");
      if (!validation.valid || password !== confirmation) {
        setNotice({
          kind: "error",
          text: validation.valid ? "The passwords do not match." : validation.message,
        });
        setBusy(false);
        return;
      }
      cooldown.start();
      try {
        await adapter.updatePassword(password);
        formElement.reset();
        setNotice({ kind: "success", text: safeAuthSuccess("reset-complete") });
      } catch {
        setNotice({ kind: "error", text: safeAuthError("reset-complete") });
      } finally {
        setBusy(false);
      }
      return;
    }

    cooldown.start();
    try {
      await adapter.requestPasswordReset(String(form.get("email") ?? "").trim());
      setNotice({ kind: "success", text: safeAuthSuccess("reset-request") });
    } catch {
      setNotice({ kind: "success", text: safeAuthSuccess("reset-request") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="reset-panel-title" className="account-card surface-panel">
      <RuntimeNote />
      <div className="account-card__heading">
        <p className="field-label">{recovery ? "Recovery session" : "Password recovery"}</p>
        <h2 id="reset-panel-title">
          {recovery ? "Choose a new password." : "Request a recovery link."}
        </h2>
        <p>
          {recovery
            ? `Use at least ${PASSWORD_MINIMUM} characters. Long passphrases are accepted without truncation.`
            : "The response stays the same whether or not an account exists."}
        </p>
      </div>
      <SetupState resolution={resolution} />
      {recovery && !notice ? (
        <StatusNotice
          notice={
            recoveryState === "error"
              ? { kind: "error", text: safeAuthError("reset-complete") }
              : recoveryState === "ready"
                ? {
                    kind: "success",
                    text: "Recovery session established. Choose a new password.",
                  }
                : recoveryState === "setup-pending"
                  ? { kind: "info", text: "Recovery is ready, but account setup is pending." }
                  : { kind: "info", text: "Establishing your recovery session…" }
          }
        />
      ) : null}
      <StatusNotice notice={notice} />
      {!recovery || recoveryReady ? (
        <form className="account-form" onSubmit={submit}>
        {recovery ? (
          <>
            <label>
              <span>New password</span>
              <input
                autoComplete="new-password"
                minLength={PASSWORD_MINIMUM}
                name="password"
                required
                type="password"
              />
            </label>
            <label>
              <span>Confirm new password</span>
              <input
                autoComplete="new-password"
                minLength={PASSWORD_MINIMUM}
                name="confirmation"
                required
                type="password"
              />
            </label>
          </>
        ) : (
          <label>
            <span>Email</span>
            <input autoComplete="email" inputMode="email" name="email" required type="email" />
          </label>
        )}
        <button
          className="catalog-button catalog-button--primary"
          disabled={!adapter || busy || cooldown.remaining > 0}
          type="submit"
        >
          {busy
            ? "Working…"
            : cooldown.remaining
              ? `Try again in ${cooldown.remaining}s`
              : recovery
                ? "Save new password"
                : "Send recovery link"}
        </button>
        </form>
      ) : null}
    </section>
  );
}

function LinkHandler({
  mode,
  resolution,
}: {
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
          setNotice({ kind: "error", text: safeAuthError("confirm") });
          return;
        }
        setReturnTo(payload.returnTo);
        if (!adapter) {
          setNotice({ kind: "info", text: "Confirmation is ready, but account setup is pending." });
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
        setNotice({ kind: "error", text: safeAuthError("callback") });
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
        setNotice({ kind: "error", text: safeAuthError("callback") });
        return;
      }
      if (!adapter) {
        setNotice({ kind: "info", text: "The handoff is valid, but account setup is pending." });
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

  return (
    <section
      aria-busy={notice.kind === "info"}
      aria-labelledby="link-handler-title"
      className="account-card account-state-card surface-panel"
      data-auth-state={notice.kind}
    >
      <RuntimeNote />
      <div className="account-card__heading">
        <p className="field-label">{mode === "confirm" ? "Account confirmation" : "Secure sign-in"}</p>
        <h2 id="link-handler-title">
          {notice.kind === "info"
            ? "Checking your link."
            : notice.kind === "success"
              ? "You are all set."
              : "This link needs a fresh start."}
        </h2>
        <p>
          We check one-time details once, clear them from the address bar, and continue only to an
          approved Fawxzzy destination.
        </p>
      </div>
      <StatusNotice notice={notice} />
      <div className="account-state-actions">
        <a className="catalog-button catalog-button--primary" href={sanitizeReturnTarget(returnTo)}>
          Continue safely
        </a>
        {notice.kind === "error" ? (
          <a className="catalog-button catalog-button--secondary" href="/login">
            Start again
          </a>
        ) : null}
      </div>
    </section>
  );
}

export function AccountPortal({ mode }: { mode: PortalMode }) {
  const resolution = useAdapterResolution();

  switch (mode) {
    case "login":
      return <LoginPanel resolution={resolution} />;
    case "account":
      return <AccountPanel resolution={resolution} />;
    case "reset":
      return <ResetPanel resolution={resolution} />;
    case "confirm":
    case "callback":
      return <LinkHandler mode={mode} resolution={resolution} />;
  }
}
