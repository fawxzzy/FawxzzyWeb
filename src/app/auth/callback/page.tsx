import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Account handoff",
  "Complete a validated authorization-code handoff for a Fawxzzy account.",
  "/auth/callback",
);

export default function CallbackPage() {
  return (
    <AccountPageShell
      eyebrow="Secure handoff"
      intro="We finish the one-time sign-in check, clean the address bar, then continue only to an approved destination."
      title="Finishing sign-in."
      variant="utility"
    >
      <AccountPortal mode="callback" />
    </AccountPageShell>
  );
}
