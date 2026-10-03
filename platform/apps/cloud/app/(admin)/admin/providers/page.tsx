import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="Providers">Connection status is a 3-state enum + last_error per tenant. A cross-tenant fleet health rollup, token-expiry forecast and rate-limit/outage view are roadmap Wave 10.</SectionStub>;
}
