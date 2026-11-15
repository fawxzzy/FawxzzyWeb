"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { AccountExperienceContext } from "@/config/account";
import { AUTH_COPY } from "@/lib/auth/copy-matrix";

/**
 * Auth Surface v2 building blocks (approved mocks 2026-11-15). Every account screen uses the same
 * anatomy: app icon, kicker, title, optional lead, a body with fields and ONE reserved notice slot,
 * links, legal, dock. Styles: src/styles/page-families/auth-surface.css. The stateless pieces live in
 * auth-status.tsx so the 404 and crash screens do not carry this module.
 */
export {
  authAccentStyle,
  AuthAppIcon,
  AuthDock,
  AuthHead,
  AuthNoticeSlot,
  AuthStatus,
} from "@/components/account/auth-status";

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

function PencilIcon() {
  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M4.5 19.5l1-4.2L15.8 5a2.1 2.1 0 013 3L8.6 18.3z" />
      <path d="M13.8 7l3 3" />
    </svg>
  );
}

type AuthFieldProps = {
  /** A locked row that can be changed: an icon button in place of the lock (account page). */
  action?: { label: string; onClick: () => void; disabled?: boolean };
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
  /**
   * A password being created (sign-up, new password): the policy minimum as `minlength` and Safari's
   * `passwordrules`, so password managers generate one the portal accepts. The form is `noValidate`,
   * so the browser never blocks on it; the portal's own checks still decide.
   */
  newPasswordMinimum?: number;
  onChange?: (value: string) => void;
  /** Password fields get a show/hide toggle. */
  secret?: boolean;
  type?: "email" | "text" | "password";
  value?: string;
};

export function AuthField({
  action,
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
  newPasswordMinimum,
  onChange,
  secret,
  type = "text",
  value,
}: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputType = secret ? (visible ? "text" : "password") : type;
  // Not in React's attribute types; a lowercase attribute is passed to the DOM as written.
  const passwordRules = newPasswordMinimum ? { passwordrules: `minlength: ${newPasswordMinimum};` } : {};
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
        minLength={newPasswordMinimum}
        name={name}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        readOnly={locked}
        spellCheck={false}
        type={inputType}
        {...(value === undefined ? {} : { value })}
        {...passwordRules}
      />
      {locked && action ? (
        <button
          aria-label={action.label}
          className="auth-field__toggle"
          data-auth-field-action={name}
          disabled={action.disabled}
          onClick={action.onClick}
          type="button"
        >
          <PencilIcon />
        </button>
      ) : locked ? (
        <LockIcon />
      ) : null}
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
