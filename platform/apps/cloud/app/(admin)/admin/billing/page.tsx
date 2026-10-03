import { requirePlatformOperator } from '@/lib/platform/auth';
import { SectionStub } from '@/components/admin/section-stub';

export const dynamic = 'force-dynamic';

export default async function Page() {
  await requirePlatformOperator();
  return <SectionStub title="Plans & Billing">Plans are hard-coded (plans.ts) and subscription state syncs from Stripe. A DB plan catalog, per-org entitlement overrides, MRR/ARR and a failed-payment queue are roadmap Wave 7-8.</SectionStub>;
}
