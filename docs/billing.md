# Billing and subscriptions

<div dir="rtl">

## بالعربية

**ما يوجد في adport أصلًا** (لم يُعدَّل): خمس باقات في `lib/cloud/plans.ts` (مجاني/Operator/Premium/Agency/Enterprise) تحدد حدود الحسابات والأعضاء ومدة الاحتفاظ وصلاحية الكتابة؛ إنشاء جلسة Stripe Checkout (اشتراك، بطاقة مطلوبة، تجربة 7 أيام، أكواد خصم) من صفحة الباقة؛ بوابة الفوترة لإدارة الاشتراك؛ webhook موقّع عند `/api/billing/webhook` يحدّث جدول `organization_subscriptions` ويخفّض الحسابات النشطة تلقائيًا عند تراجع الباقة ويسجّل حدث تدقيق؛ وحماية من تكرار الأحداث عبر `private.billing_events`.

**ما كان ينقص وأضافته markting-ai**: المنتجات والأسعار نفسها في Stripe، وطريقة تمرير الـ webhook محليًا. السكربت `infra/scripts/stripe-setup.mjs` ينشئ ثلاثة منتجات وستة أسعار (شهري/سنوي) بمفاتيح بحث ثابتة فلا يكرّرها عند إعادة التشغيل، ويكتب معرّفاتها في `.env`.

**التجربة في وضع الاختبار**:

```sh
# 1. مفتاح سرّي للاختبار من لوحة Stripe → Developers → API keys، ضعه في .env باسم STRIPE_SECRET_KEY
make stripe-setup        # ينشئ المنتجات والأسعار ويكتب STRIPE_*_PRICE_ID في .env
make stripe-listen       # في طرفية ثانية: يطبع whsec_... ضعه في STRIPE_WEBHOOK_SECRET ثم أعد تشغيل التطبيق
```

ثم من صفحة الباقة اختر Operator وادفع ببطاقة الاختبار `4242 4242 4242 4242`. بعد عودة Stripe يستقبل التطبيق `customer.subscription.created` وتتحول الباقة إلى Operator وتُفتح صلاحية الكتابة (`tools:write`)، وهو ما كان الـ seed التجريبي يفعله يدويًا.

**الضريبة (VAT 15% في السعودية)**: الأسعار الحالية باليورو وبدون ضريبة كما في المشروع الأصلي. الخيار المناسب هو تفعيل Stripe Tax في لوحة Stripe ثم إضافة `automatic_tax: { enabled: true }` إلى جلسة Checkout في `app/dashboard/billing/actions.ts` (تعديل سطر واحد في الشجرة الأصلية؛ لم أُجره بدون قرارك)، وتغيير العملة إلى الريال يعني تغيير الأسعار في `plans.ts` وفي السكربت معًا.

</div>

## In English

**Shipped by adport** (unchanged): five plans in `lib/cloud/plans.ts` with account/member/retention/write limits; Stripe Checkout session creation from the Plan page (subscription mode, card required, 7-day trial, promotion codes); the billing portal; a signed webhook at `/api/billing/webhook` that updates `organization_subscriptions`, downsizes active accounts when a plan shrinks and writes an audit event; duplicate protection via `private.billing_events`.

**Added here**: the Stripe products and prices themselves and the local webhook path. `infra/scripts/stripe-setup.mjs` creates three products and six prices (monthly/annual) with stable lookup keys, so re-runs find instead of duplicate, and writes the ids into `.env`. Covered by `node --test infra/scripts/stripe-setup.test.mjs` with a fake Stripe client.

**Test-mode walkthrough**:

```sh
# 1. a TEST secret key from Stripe Dashboard → Developers → API keys into .env as STRIPE_SECRET_KEY
make stripe-setup        # creates products/prices, writes STRIPE_*_PRICE_ID into .env
make stripe-listen       # second terminal: prints whsec_..., put it in STRIPE_WEBHOOK_SECRET, restart the app
```

Pick Operator on the Plan page and pay with test card `4242 4242 4242 4242`. The app receives `customer.subscription.created`, the plan flips to Operator and `tools:write` is granted, which is what the demo seed did by hand.

**Tax (15 % VAT in Saudi Arabia)**: prices are EUR and tax-exclusive as upstream. The right option is Stripe Tax plus `automatic_tax: { enabled: true }` in the Checkout session (`app/dashboard/billing/actions.ts`, a one-line upstream edit left for your decision); switching to SAR means changing amounts in `plans.ts` and in the script together.

**Flow**: Plan page → `startSubscription` → Stripe Checkout → webhook → `applySubscription` → `organization_subscriptions` → `applyPlanToPrincipal` strips or grants `tools:write` → Assistant/Approvals previews allowed or refused.
