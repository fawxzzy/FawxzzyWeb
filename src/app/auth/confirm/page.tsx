import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { productIdentity } from "@/config/product";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Confirm account",
  `Confirm your ${productIdentity.publicName} account.`,
  "/auth/confirm",
);

export default function ConfirmPage() {
  return (
    <AccountPageShell
      eyebrow="Account"
      intro="We are checking your confirmation link."
      title="Confirm your account."
      variant="utility"
    >
      <AccountPortal mode="confirm" />
    </AccountPageShell>
  );
}
