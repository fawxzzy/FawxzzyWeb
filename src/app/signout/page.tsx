import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Sign out",
  "Ending your Fawxzzy account session.",
  "/signout",
);

export default function SignOutPage() {
  return (
    <AccountPageShell
      eyebrow="Sign out"
      intro="Ending your Fawxzzy account session."
      title="Signing you out."
      variant="utility"
    >
      <AccountPortal mode="signout" />
    </AccountPageShell>
  );
}
