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
      eyebrow="Fawxzzy account"
      intro="Your apps and account status in one place."
      title="Your account."
    >
      <AccountPortal mode="account" />
    </AccountPageShell>
  );
}
