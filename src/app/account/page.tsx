import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { productIdentity } from "@/config/product";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Account",
  `Sign in and manage your ${productIdentity.publicName} apps.`,
  "/account",
);

export default function AccountPage() {
  return (
    <AccountPageShell
      eyebrow={`${productIdentity.publicName} account`}
      intro="Your apps and account status in one place."
      title="Your account."
    >
      <AccountPortal mode="account" />
    </AccountPageShell>
  );
}
