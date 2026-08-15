import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Reset password",
  "Get a recovery link or choose a new password.",
  "/reset-password",
);

export default function ResetPasswordPage() {
  return (
    <AccountPageShell
      eyebrow="Account recovery"
      intro="Get a recovery link or choose a new password."
      title="Reset your password."
      variant="utility"
    >
      <AccountPortal mode="reset" />
    </AccountPageShell>
  );
}
