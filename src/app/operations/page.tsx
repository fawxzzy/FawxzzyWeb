import { AccountPageShell } from '@/components/account/account-page-shell';
import { PrivateOperations } from '@/components/operations/private-operations';
import { accountPageMetadata } from '@/lib/account-metadata';

export const metadata = accountPageMetadata('Private operations', 'Your private work overview.', '/operations');

export default function OperationsPage() {
  return (
    <AccountPageShell eyebrow="Private workspace" title="Operations" intro="Review your work in one place.">
      <PrivateOperations />
    </AccountPageShell>
  );
}
