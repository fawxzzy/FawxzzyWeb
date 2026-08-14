import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Sign in",
  "Sign in to your Fawxzzy account or create a new one.",
  "/login",
);

export default function LoginPage() {
  return (
    <AccountPageShell
      eyebrow="Account"
      intro="Sign in or create your Fawxzzy account."
      title="Welcome back."
      variant="utility"
    >
      <AccountPortal mode="login" />
    </AccountPageShell>
  );
}
