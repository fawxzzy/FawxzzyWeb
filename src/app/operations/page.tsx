import { OperationsRedirect } from '@/components/operations/operations-redirect';
import { accountPageMetadata } from '@/lib/account-metadata';

export const metadata = accountPageMetadata('Fawxzzy', 'Fawxzzy.', '/projects');

export default function OperationsPage() {
  return <OperationsRedirect />;
}
