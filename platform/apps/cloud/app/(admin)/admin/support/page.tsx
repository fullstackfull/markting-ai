import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="Support">The feedback table has a status lifecycle that is never updated. An operator triage queue + customer-health score are roadmap Wave 15.</SectionStub>;
}
