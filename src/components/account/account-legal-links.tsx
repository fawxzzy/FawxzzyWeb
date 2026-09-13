import { Fragment } from "react";
import type { AccountExperienceContext } from "@/config/account";

export function AccountTextDivider() {
  return (
    <span aria-hidden="true" className="account-link-separator">
      <span />
    </span>
  );
}

export function AccountLegalLinks({ context }: { context: AccountExperienceContext }) {
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
