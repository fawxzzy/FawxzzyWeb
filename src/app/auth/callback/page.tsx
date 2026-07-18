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
      intro="Only an authorization code with matching browser state can complete this route."
      title="Finish signing in."
    >
      <AccountPortal mode="callback" />
    </AccountPageShell>
  );
}
