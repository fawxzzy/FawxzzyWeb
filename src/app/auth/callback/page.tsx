import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { productIdentity } from "@/config/product";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Account handoff",
  `Finish signing in to your ${productIdentity.publicName} account.`,
  "/auth/callback",
);

export default function CallbackPage() {
  return (
    <AccountPageShell
      eyebrow="Account"
      intro="This should only take a moment."
      title="Signing you in."
      variant="utility"
    >
      <AccountPortal mode="callback" />
    </AccountPageShell>
  );
}
