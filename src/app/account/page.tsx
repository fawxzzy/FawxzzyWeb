import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Account",
  "Review the session and safe account settings available on this Fawxzzy account origin.",
  "/account",
);

export default function AccountPage() {
  return (
    <AccountPageShell
      eyebrow="Account home"
      intro="See this origin's session, manage safe credential updates, and understand what remains capability-gated."
      title="One identity. Clear boundaries."
    >
      <AccountPortal mode="account" />
    </AccountPageShell>
  );
}
