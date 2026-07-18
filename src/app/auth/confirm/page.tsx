import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Confirm account",
  "Complete a one-time Fawxzzy account confirmation safely.",
  "/auth/confirm",
);

export default function ConfirmPage() {
  return (
    <AccountPageShell
      eyebrow="One-time link"
      intro="Confirmation material is handled once, then removed from the visible URL."
      title="Confirm your account."
    >
      <AccountPortal mode="confirm" />
    </AccountPageShell>
  );
}
