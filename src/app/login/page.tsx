import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Sign in",
  "Sign in to or create a shared Fawxzzy account with email and password.",
  "/login",
);

export default function LoginPage() {
  return (
    <AccountPageShell
      eyebrow="Fawxzzy account"
      intro="One identity for Fawxzzy products, with each product keeping its own data and session."
      title="Your account starts here."
    >
      <AccountPortal mode="login" />
    </AccountPageShell>
  );
}
