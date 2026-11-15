import { accountContract, accountExperienceContexts } from "@/config/account";
import { AuthDock, AuthStatus } from "@/components/account/auth-status";
import { STATUS_COPY } from "@/lib/auth/status-copy";

// The one "this page is not here" body, shared by the 404 page (one static 404 for every host) and
// by pages that must look nonexistent to anyone who is not allowed to see them (Projects).
export function NotFoundState() {
  return (
    <AuthStatus
      context={accountExperienceContexts.website}
      dock={<AuthDock href={new URL(accountContract.accountPath, accountContract.canonicalOrigin).href}>{STATUS_COPY.goToAccount}</AuthDock>}
      kickerBelowIcon
      lead={STATUS_COPY.pageNotFoundLead}
      state="not-found"
      surface="not-found"
      title={STATUS_COPY.pageNotFound}
    />
  );
}
