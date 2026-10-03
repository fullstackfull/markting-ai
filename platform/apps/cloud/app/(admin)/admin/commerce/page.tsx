import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="Commerce">Per-tenant store connections, sync state and webhook/dead-letter events exist. A fleet store/sync-health and webhook-failure rollup is roadmap Wave 11.</SectionStub>;
}
