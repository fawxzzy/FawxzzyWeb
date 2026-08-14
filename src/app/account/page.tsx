import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Account",
  "Manage your Fawxzzy sign-in and connected apps.",
  "/account",
);

export default function AccountPage() {
  return (
    <AccountPageShell
      eyebrow="Account"
      intro="Manage your sign-in and connected apps."
      title="Your account."
    >
      <AccountPortal mode="account" />
    </AccountPageShell>
  );
}
