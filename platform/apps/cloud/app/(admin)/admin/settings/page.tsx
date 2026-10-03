import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="Settings">Platform configuration (support metadata, operational thresholds, safe billing mappings). No secrets are editable here. Roadmap Wave 17.</SectionStub>;
}
