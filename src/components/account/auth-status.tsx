import type { ReactNode } from "react";
import type { AccountExperienceContext, AccountExperienceContextId } from "@/config/account";
import type { AuthNotice } from "@/lib/auth/copy-matrix";
import { authThemes } from "../../../supabase/functions/_shared/auth-theme.mjs";

/**
 * Auth Surface v2 pieces with no state and no copy of their own: app icon, head, notice slot, dock
 * and the status screen. Kept apart from `auth-surface.tsx` (a client module that carries the full
 * copy matrix) because the 404 and crash screens use them on every route: the 404 renders them on
 * the server and the error boundaries ship only this small module. Re-exported by `auth-surface`.
 */

/** Branding files already shipped in public/ (no drawn shapes); the auth emails use the same artwork. */
const APP_ICONS: Record<AccountExperienceContextId, string> = {
  website: authThemes.website.iconPath,
  fitness: authThemes.fitness.iconPath,
  mazer: authThemes.mazer.iconPath,
};

/** What a status screen needs to know about its app. */
export type AuthStatusContext = Pick<AccountExperienceContext, "accentRgb" | "id" | "productName">;

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
  context: AuthStatusContext;
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
  kickerBelowIcon = false,
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
  context: AuthStatusContext;
  dock?: ReactNode;
  /** The product name under the icon, as on the form screens (the 404), instead of at the top. */
  kickerBelowIcon?: boolean;
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
      {kickerBelowIcon ? null : <p className="auth-kicker">{context.productName}</p>}
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
        {kickerBelowIcon ? <p className="auth-kicker">{context.productName}</p> : null}
        <h1 className="auth-title" id={`${surface}-status-title`}>{title}</h1>
        {lead ? <p className="auth-lead">{lead}</p> : null}
        {notice !== undefined ? <AuthNoticeSlot notice={notice} onAction={onNoticeAction} /> : null}
      </div>
      {dock}
    </section>
  );
}
