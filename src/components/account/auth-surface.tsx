"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { AccountExperienceContext, AccountExperienceContextId } from "@/config/account";
import { AUTH_COPY, type AuthNotice } from "@/lib/auth/copy-matrix";

/**
 * Auth Surface v2 building blocks (approved mocks 2026-11-15). Every account screen uses the same
 * anatomy: app icon, kicker, title, optional lead, a body with fields and ONE reserved notice slot,
 * links, legal, dock. Styles: src/styles/page-families/auth-surface.css.
 */

/** Branding files already shipped in public/ (no drawn shapes). */
const APP_ICONS: Record<AccountExperienceContextId, string> = {
  website: "/app/icon-192.png",
  fitness: "/apps/fitness/storefront-icon.webp",
  mazer: "/apps/mazer/storefront-icon.webp",
};

export function authAccentStyle(context: Pick<AccountExperienceContext, "accentRgb">) {
  return { "--auth-accent": context.accentRgb } as React.CSSProperties;
}

export function AuthAppIcon({ app, top = false }: { app: AccountExperienceContextId; top?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export; fixed-size local branding file
    <img
      alt=""
      className={top ? "auth-app-icon auth-app-icon--top" : "auth-app-icon"}
      data-auth-icon={app}
      decoding="async"
      height={76}
      src={APP_ICONS[app]}
      width={76}
    />
  );
}

export function AuthHead({
  context,
  lead,
  title,
  titleId,
}: {
  context: AccountExperienceContext;
  lead?: string;
  title: string;
  titleId: string;
}) {
  return (
    <header className="auth-head">
      <AuthAppIcon app={context.id} top />
      <p className="auth-kicker">{context.productName}</p>
      <h1 className="auth-title" id={titleId}>{title}</h1>
      {lead ? <p className="auth-lead">{lead}</p> : null}
    </header>
  );
}

function NoticeIcon({ tone }: { tone: AuthNotice["tone"] }) {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" />
      {tone === "success" ? <path d="M8 12.4l2.8 2.8L16.2 9.4" /> : tone === "info" ? <path d="M12 11v5.5M12 7.6v.1" /> : <path d="M12 7.5v5.5M12 16.4v.1" />}
    </svg>
  );
}

/**
 * The one message box (id `auth-notice`, the target of an invalid field's aria-describedby). Its
 * slot is always rendered at a fixed height so nothing moves when a message appears or clears. `onAction` renders the matrix action (Retry, Sign in) inline.
 */
export function AuthNoticeSlot({
  notice,
  onAction,
}: {
  notice: AuthNotice | null;
  onAction?: () => void;
}) {
  return (
    <div className="auth-slot" data-auth-slot>
      {notice ? (
        <div
          className={`auth-notice auth-notice--${notice.tone}`}
          data-notice-id={notice.id}
          data-notice-kind={notice.tone}
          id="auth-notice"
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <NoticeIcon tone={notice.tone} />
          <p className="auth-notice__text">
            {notice.text}
            {notice.action && onAction ? (
              <button className="auth-notice__action" onClick={onAction} type="button">
                {notice.action}
              </button>
            ) : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" className="auth-field__icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <rect height="9.5" rx="2.5" width="14" x="5" y="10.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      {visible ? null : <path d="M4 4l16 16" />}
    </svg>
  );
}

type AuthFieldProps = {
  autoComplete?: string;
  describedBy?: string;
  disabled?: boolean;
  id: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  invalid?: boolean;
  label: string;
  /** Shown, not typed: a remembered identity, the signed-in email or a value already sent. */
  locked?: boolean;
  maxLength?: number;
  name: string;
  onChange?: (value: string) => void;
  /** Password fields get a show/hide toggle. */
  secret?: boolean;
  type?: "email" | "text" | "password";
  value?: string;
};

export function AuthField({
  autoComplete,
  describedBy,
  disabled,
  id,
  inputMode,
  invalid,
  label,
  locked,
  maxLength,
  name,
  onChange,
  secret,
  type = "text",
  value,
}: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputType = secret ? (visible ? "text" : "password") : type;
  return (
    <div
      className="auth-field"
      data-auth-field={name}
      data-invalid={invalid || undefined}
      data-locked={locked || undefined}
    >
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect="off"
        disabled={disabled}
        id={id}
        inputMode={inputMode}
        maxLength={maxLength}
        name={name}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        readOnly={locked}
        spellCheck={false}
        type={inputType}
        {...(value === undefined ? {} : { value })}
      />
      {locked ? <LockIcon /> : null}
      {secret && !locked ? (
        <button
          aria-label={visible ? AUTH_COPY.aria.hidePassword : AUTH_COPY.aria.showPassword}
          className="auth-field__toggle"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          <EyeIcon visible={visible} />
        </button>
      ) : null}
    </div>
  );
}

/** Text links under the body, separated by short accent bars. */
export function AuthLinks({ children }: { children: ReactNode[] | ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="auth-links">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? <span aria-hidden="true" className="auth-bar" /> : null}
          {item}
        </Fragment>
      ))}
    </div>
  );
}

export function AuthLegal({ context }: { context: AccountExperienceContext }) {
  if (context.legalLinks.length === 0) return null;
  return (
    <div aria-label={`${context.productName} legal`} className="auth-legal">
      {context.legalLinks.map((link, index) => (
        <Fragment key={link.href}>
          {index > 0 ? <span aria-hidden="true" className="auth-bar" /> : null}
          <a href={link.href}>{link.label}</a>
        </Fragment>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg aria-hidden="true" className="auth-dock__spinner" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" viewBox="0 0 24 24">
      <circle cx="12" cy="12" opacity=".25" r="9" />
      <path d="M12 3a9 9 0 019 9" />
    </svg>
  );
}

type AuthDockProps = {
  busy?: boolean;
  children: string;
  disabled?: boolean;
} & (
  | { form: string; href?: never; onClick?: never }
  | { form?: never; href: string; onClick?: never }
  | { form?: never; href?: never; onClick: () => void }
);

/** The one primary action. It only ever says what it does or what it is doing; never an error. */
export function AuthDock({ busy, children, disabled, form, href, onClick }: AuthDockProps) {
  if (href) {
    return (
      <div className="auth-dock">
        <a className="auth-dock__button" href={href}>{children}</a>
      </div>
    );
  }
  return (
    <div className="auth-dock">
      <button
        aria-busy={busy || undefined}
        className="auth-dock__button"
        data-busy={busy || undefined}
        disabled={disabled || busy}
        form={form}
        onClick={onClick}
        type={form ? "submit" : "button"}
      >
        {busy ? <Spinner /> : null}
        {children}
      </button>
    </div>
  );
}

/**
 * The status screen: callback, confirm, sign-out, account check, OAuth fallback, 404 and crash. A
 * loader (`spin`) moves on by itself; a stopped state carries a lead or a notice and a dock.
 */
export function AuthStatus({
  app,
  children,
  context,
  dock,
  lead,
  notice,
  onNoticeAction,
  spin = false,
  state,
  surface,
  title,
}: {
  app?: AccountExperienceContextId;
  children?: ReactNode;
  context: AccountExperienceContext;
  dock?: ReactNode;
  lead?: string;
  notice?: AuthNotice | null;
  onNoticeAction?: () => void;
  spin?: boolean;
  state: string;
  surface: string;
  title: string;
}) {
  return (
    <section
      aria-busy={spin || undefined}
      aria-labelledby={`${surface}-status-title`}
      className="auth-surface auth-surface--status"
      data-auth-product={context.id}
      data-auth-state={state}
      data-auth-surface={surface}
      style={authAccentStyle(context)}
    >
      {children}
      <p className="auth-kicker">{context.productName}</p>
      <div className="auth-status" role={spin ? "status" : undefined}>
        <div className={spin ? "auth-mark auth-mark--spin" : "auth-mark"}>
          {spin ? (
            <svg aria-hidden="true" className="auth-mark__ring" viewBox="0 0 100 100">
              <circle className="auth-mark__track" cx="50" cy="50" r="48" />
              <circle className="auth-mark__arc" cx="50" cy="50" r="48" strokeDasharray="70 230" />
            </svg>
          ) : null}
          <AuthAppIcon app={app ?? context.id} />
        </div>
        <h1 className="auth-title" id={`${surface}-status-title`}>{title}</h1>
        {lead ? <p className="auth-lead">{lead}</p> : null}
        {notice !== undefined ? <AuthNoticeSlot notice={notice} onAction={onNoticeAction} /> : null}
      </div>
      {dock}
    </section>
  );
}
