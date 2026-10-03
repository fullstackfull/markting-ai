import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="System Health">Job tables (reconciliation, observation) exist but have no runner; there is no /health endpoint. An operator jobs/queue view + runner are roadmap Wave 12.</SectionStub>;
}
