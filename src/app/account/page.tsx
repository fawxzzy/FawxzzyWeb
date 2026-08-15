import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Account",
  "Sign in and manage your Fawxzzy apps.",
  "/account",
);

export default function AccountPage() {
  return (
    <AccountPageShell
      eyebrow="Account"
      intro="Sign in and manage your apps in one place."
      title="Your account."
    >
      <AccountPortal mode="account" />
    </AccountPageShell>
  );
}
