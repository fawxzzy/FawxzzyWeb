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
      intro="Use one shared identity while every Fawxzzy product keeps its own session and product data."
      title="Sign in to Fawxzzy."
      variant="utility"
    >
      <AccountPortal mode="login" />
    </AccountPageShell>
  );
}
