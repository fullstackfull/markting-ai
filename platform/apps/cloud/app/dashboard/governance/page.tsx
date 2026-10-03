import { PageHeader } from '@/components/ui';
import { StatusChip, DataTable, BlockedState, type Tone } from '@/components/kit';
import { requireDashboardTenant } from '@/lib/cloud/dashboard';
import { getT } from '@/lib/i18n/server';
import { RUNTIME_MODES, resolveRuntimeMode } from '@/lib/markting/runtime-mode';
import { resolveCapabilities, isModeA, providerWritesPossible } from '@/lib/markting/ops/mode-a';
import { DEMO_GATEWAY_CONFIG } from '@/lib/markting/ai-gateway';

export const metadata = { title: 'Governance & usage' };

/**
 * Hardening Programs 29/30 — READ-ONLY governance & usage visibility. This surface adds NO mutation
 * path: it renders only pure, no-DB facts (the resolved runtime mode, the Mode-A/B capability matrix,
 * the AI-usage budget, and the kill-switch enforcement model) so an operator can SEE the safety posture
 * — provider writes held, autonomous optimization structurally impossible — without being able to
 * change it here. Per-organization live numbers (actual AI spend, active kill switches) are backend
 * governance and appear only on a connected deployment; they are never fabricated in demo.
 */
export default async function GovernancePage() {
  await requireDashboardTenant();
  const { locale } = await getT();
  const L = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const mode = resolveRuntimeMode();
  const caps = resolveCapabilities(mode);
  const yesNo = (b: boolean): [Tone, string] => (b ? ['good', L('yes', 'نعم')] : ['neutral', L('no', 'لا')]);
  const q = DEMO_GATEWAY_CONFIG.quota;

  return (
    <main className="page">
      <PageHeader title={L('Governance & usage', 'الحوكمة والاستخدام')} description={L('Read-only view of the safety posture: runtime mode, write capabilities, the AI-usage budget, and kill-switch enforcement. Nothing on this page can change state.', 'عرض للقراءة فقط لوضع الأمان: وضع التشغيل، صلاحيات الكتابة، ميزانية استخدام الذكاء، وتفعيل مفتاح الإيقاف. لا شيء هنا يغيّر الحالة.')} />

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Runtime mode', 'وضع التشغيل')}</h2></div>
        <p className="cell-sub">{L('Current mode', 'الوضع الحالي')}: <StatusChip tone="info" label={mode} /> {isModeA(mode) && <StatusChip tone="good" label={L('Mode A (read + recommend, no writes)', 'الوضع أ (قراءة وتوصية، دون كتابة)')} />}</p>
        <p className="cell-sub">{L('The mode ladder is ordered safest → least safe. There is deliberately no autonomous-write mode — autonomous provider writes cannot be expressed, so no configuration can enable them.', 'سلّم الأوضاع مرتّب من الأأمن إلى الأقل. لا يوجد عمدًا وضع كتابة تلقائية — لا يمكن التعبير عن الكتابة التلقائية، فلا إعداد يفعّلها.')}</p>
        <DataTable caption={L('Runtime mode ladder', 'سلّم أوضاع التشغيل')} head={[L('Mode', 'الوضع'), L('Current', 'الحالي')]} rows={RUNTIME_MODES.map((m) => [m, m === mode ? <StatusChip key={m} tone="info" label={L('active', 'نشط')} /> : ''])} />
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('Write capabilities', 'صلاحيات الكتابة')}</h2></div>
        <DataTable caption={L('Capability matrix for the current mode', 'مصفوفة الصلاحيات للوضع الحالي')} head={[L('Capability', 'الصلاحية'), L('Allowed', 'مسموح')]} rows={[
          [L('Read providers', 'قراءة المزوّدين'), chip(yesNo(caps.readProviders))],
          [L('Recommend (review-only)', 'توصية (مراجعة فقط)'), chip(yesNo(caps.recommend))],
          [L('Preview writes (validate)', 'معاينة الكتابة (تحقق)'), chip(yesNo(caps.previewWrites))],
          [L('Apply writes (human-approved only)', 'تطبيق الكتابة (بموافقة بشرية فقط)'), chip(yesNo(caps.applyWrites))],
        ]} />
        <p className="cell-sub">{L('Autonomous optimization is disabled. Provider writes are possible only via a human-approved apply, and only in the Phase-0 ceiling mode.', 'التحسين التلقائي معطّل. الكتابة للمزوّد ممكنة فقط عبر تطبيق بموافقة بشرية، وفي وضع السقف فقط.')} <StatusChip tone={providerWritesPossible(mode) ? 'warn' : 'good'} label={providerWritesPossible(mode) ? L('writes possible (approval-gated)', 'الكتابة ممكنة (ببوابة موافقة)') : L('writes held', 'الكتابة محجوزة')} /></p>
      </section>

      <section className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><h2>{L('AI usage budget', 'ميزانية استخدام الذكاء')}</h2></div>
        <DataTable caption={L('AI gateway quota', 'حصة بوابة الذكاء')} head={[L('Limit', 'الحد'), L('Value', 'القيمة')]} rows={[
          [L('Window', 'النافذة'), `${Math.round(q.windowMs / 3_600_000)}h`],
          [L('Max requests / window', 'أقصى طلبات/نافذة'), String(q.maxRequests)],
          [L('Max cost / window', 'أقصى تكلفة/نافذة'), `${(q.maxCostMicros / 1_000_000).toFixed(2)} (micros→units)`],
        ]} />
        <p className="cell-sub">{L('Every AI call is metered and the quota fails closed (POLICY_VIOLATION) when exceeded. Actual per-organization consumption is recorded server-side and appears on a connected deployment.', 'كل نداء ذكاء يُقاس وتفشل الحصة مغلقة عند التجاوز. الاستهلاك الفعلي لكل مؤسسة يُسجَّل خادميًا ويظهر على نشر متّصل.')}</p>
      </section>

      <section className="card">
        <div className="card-head"><h2>{L('Kill-switch enforcement', 'تفعيل مفتاح الإيقاف')}</h2></div>
        <p className="cell-sub">{L('Kill switches can block writes (and optionally reads) at five scopes: global, organization, provider, account, action-type. State is read fail-closed: if it cannot be read, writes are blocked.', 'يمكن لمفاتيح الإيقاف حجب الكتابة (والقراءة اختياريًا) على خمسة نطاقات: عام، مؤسسة، مزوّد، حساب، نوع إجراء. تُقرأ الحالة بفشل مغلق: إن تعذّرت القراءة تُحجب الكتابة.')}</p>
        <BlockedState title={L('Active kill switches', 'مفاتيح الإيقاف النشطة')} reason={L('Shown on a connected deployment — active switches are per-organization backend state and are never fabricated in demo mode. This page is read-only; switches are set through the governed change-management path, not here.', 'تظهر على نشر متّصل — المفاتيح النشطة حالة خادمية لكل مؤسسة ولا تُختلق في وضع العرض. هذه الصفحة للقراءة فقط؛ تُضبط المفاتيح عبر مسار إدارة التغيير المحكوم وليس هنا.')} />
      </section>
    </main>
  );
}

function chip([tone, label]: [Tone, string]) {
  return <StatusChip tone={tone} label={label} />;
}
