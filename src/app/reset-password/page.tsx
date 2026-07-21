import { AccountPageShell } from "@/components/account/account-page-shell";
import { AccountPortal } from "@/components/account/account-portal";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Reset password",
  "Request or complete a Fawxzzy account password recovery.",
  "/reset-password",
);

export default function ResetPasswordPage() {
  return (
    <AccountPageShell
      eyebrow="Account recovery"
      intro="Request a private recovery link or choose a new password after the one-time check succeeds."
      title="Recover your account."
      variant="utility"
    >
      <AccountPortal mode="reset" />
    </AccountPageShell>
  );
}
