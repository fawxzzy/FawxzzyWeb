import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { productIdentity } from "@/config/product";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Sign in",
  `Sign in to your ${productIdentity.publicName} account or create a new one.`,
  "/login",
);

export default function LoginPage() {
  return (
    <AccountPageShell
      eyebrow={`${productIdentity.publicName} account`}
      intro={`One secure place for your ${productIdentity.publicName} apps.`}
      title="Welcome back."
      variant="utility"
    >
      <AccountPortal mode="login" />
    </AccountPageShell>
  );
}
