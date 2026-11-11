import { AccountPageShell } from "@/components/account/account-page-shell";
import { MazerOAuthAuthorization } from "@/components/account/mazer-oauth-authorization";
import { accountPageMetadata } from "@/lib/account-metadata";

export const metadata = accountPageMetadata(
  "Mazer sign-in",
  "Sign in to Mazer with your Fawxzzy account.",
  "/oauth/authorize",
);

export default function MazerOAuthAuthorizePage() {
  return (
    <AccountPageShell
      eyebrow="Fawxzzy account"
      intro="One secure account for Mazer and every Fawxzzy app."
      title="Mazer sign-in."
      variant="utility"
    >
      <MazerOAuthAuthorization />
    </AccountPageShell>
  );
}
