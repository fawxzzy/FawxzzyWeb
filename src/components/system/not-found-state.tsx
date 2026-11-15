import { accountContract, accountExperienceContexts } from "@/config/account";
import { AuthDock, AuthStatus } from "@/components/account/auth-surface";
import { AUTH_COPY } from "@/lib/auth/copy-matrix";

// The one "this page is not here" body, shared by the 404 page (one static 404 for every host) and
// by pages that must look nonexistent to anyone who is not allowed to see them (Projects).
export function NotFoundState() {
  return (
    <AuthStatus
      context={accountExperienceContexts.website}
      dock={<AuthDock href={new URL(accountContract.accountPath, accountContract.canonicalOrigin).href}>{AUTH_COPY.button.goToAccount}</AuthDock>}
      lead={AUTH_COPY.lead.pageNotFound}
      state="not-found"
      surface="not-found"
      title={AUTH_COPY.title.pageNotFound}
    />
  );
}
