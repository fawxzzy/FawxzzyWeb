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
      intro="We check this link once, clear it from the address bar, and keep the next destination inside the approved Fawxzzy route set."
      title="Confirm your account."
      variant="utility"
    >
      <AccountPortal mode="confirm" />
    </AccountPageShell>
  );
}
