import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="Feature Flags">The only flag mechanism is an env-var provider allowlist (provider-rollout.ts). A DB-backed global/plan/org flag model is roadmap Wave 16.</SectionStub>;
}
