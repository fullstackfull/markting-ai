<div dir="rtl">

# markting-ai — مشتري الإعلانات الذكي (عربي أولًا)

منصة SaaS تجمع بين مشروعين مفتوحي المصدر برخصة Apache-2.0 في مستودع واحد:

- **[adport](https://github.com/ynnickw/adport)** في `platform/`: لوحة التحكم، ربط الحسابات الإعلانية عبر OAuth، التقارير الموحّدة، **محرك السياسات** (معاينة ← موافقة معلّقة ← تنفيذ)، وسجل التدقيق.
- **[paid-media-agent](https://github.com/langchain-ai/paid-media-agent)** في `engine/`: محرك التحليل بالذكاء الاصطناعي، التقارير الدورية، ومقترحات تغيير الحملات.

**القاعدة الواحدة التي لا تتغير:** هناك مسار كتابة واحد فقط إلى منصات الإعلان، وهو محرك سياسات adport. محرك الذكاء الاصطناعي **يقترح فقط**؛ كل اقتراح يتحوّل إلى عملية مُعاينة في صفحة الموافقات، ولا يُنفَّذ شيء إلا بعد موافقة إنسان هناك.

## ماذا يفعل

- يحلّل أداء الحسابات المرتبطة (الإنفاق، التحويلات، CPA، ROAS) ويجيب عن الأسئلة في صفحة **المساعد**.
- يُنتج تقارير أسبوعية وشهرية حتمية (HTML وPDF) من صفحة **التقارير**.
- يحوّل أي تغيير يقترحه المحرك (ميزانية أو حالة حملة) إلى معاينة محمية بسياسات المؤسسة (سقف تغيير الميزانية، الحسابات المحمية، مهلة الموافقة)، ثم يسمح بتنفيذها أو رفضها من صفحة **الموافقات**.
- الواجهة عربية افتراضيًا ومن اليمين إلى اليسار، مع الإنجليزية بضغطة واحدة. المصطلحات الإعلانية (ROAS, CPA, CTR) تبقى بالإنجليزية.
- وضع تجريبي كامل بدون أي بيانات اعتماد إعلانية أو مفتاح نموذج: حسابات اصطناعية ومحرك مبرمج، لكن بنفس بوابة السياسات.

## التشغيل محليًا

المتطلبات: Docker، Node.js 22 مع pnpm (عبر corepack)، والقدرة على تشغيل Supabase CLI عبر `npx`.

```sh
git clone https://github.com/fullstackfull/markting-ai
cd markting-ai
make env     # ينسخ .env.example إلى .env ويولّد الأسرار العشوائية
make up      # يشغّل Supabase محليًا (منافذ 553xx) ثم docker compose: التطبيق + المحرك + Postgres المحرك
make seed    # ينشئ مساحة عمل تجريبية: demo@markting.local (كلمة المرور في .env)
```

ثم افتح `http://localhost:3000` وسجّل الدخول. جرّب في صفحة المساعد: «ما الذي يحتاج انتباهي هذا الأسبوع؟» ثم «خفّض الميزانية اليومية لحملة Performance Max إلى 240»، وراجع صفحة الموافقات.

أوامر أخرى: `make test` (اختبارات الجسر ومضيف المحرك)، `make logs`، `make down`.

لماذا Supabase خارج docker-compose؟ لأن ترحيلات adport تحتاج `auth.users` وpg_cron ودور `adport_backend`، وهي متوفرة فقط في صورة Supabase التي يديرها الـ CLI.

## متغيرات البيئة

كل القيم في `.env` (غير متتبَّع في git). القائمة الكاملة مع الشرح في `.env.example`.

| المتغير | الوصف |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` | اتصال adport بقاعدة Supabase المحلية. يملؤها `make up`. |
| `ADPORT_CLOUD_ENCRYPTION_KEY`, `ADPORT_API_KEY_PEPPER`, `ADPORT_MCP_OAUTH_SIGNING_KEY` | أسرار adport. يولّدها `make env`. |
| `MARKTING_ENGINE_TOKEN` | رمز الخدمة بين خادم adport والمحرك (لا يصل إلى المتصفح أبدًا). يولّده `make env`. |
| `MARKTING_DEMO_MODE` | `true` = مزوّد sandbox الاصطناعي؛ `false` = الحسابات الحقيقية المرتبطة عبر OAuth. |
| `MARKTING_ALLOW_SELF_APPROVAL` | السماح لمن طلب التغيير بتنفيذه (للعروض الفردية فقط). |
| `MARKTING_ENGINE_MODE` | `demo` = نموذج مبرمج بلا مفتاح؛ `live` = `PAID_MEDIA_MODEL` ومفتاحه. |
| `PAID_MEDIA_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | النموذج ومفتاحه في وضع `live` فقط. |
| `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`, `SNAPCHAT_OAUTH_ENABLED` | تفعيل مزوّد Snapchat في تطبيق الـ cloud. |
| `MARKTING_DEMO_EMAIL`, `MARKTING_DEMO_PASSWORD` | حساب العرض التجريبي الذي ينشئه `make seed`. |

## ما ليس جاهزًا للإنتاج بعد

- لا فوترة أو اشتراكات، ولا موافقات عبر WhatsApp، ولا تكامل مع سلة أو زد. انظر `docs/TODO.md`.
- بوابات الإنتاج في المشروعين الأصليين (نشر، مفاتيح، مراجعة تطبيقات OAuth لدى كل منصة) لم تُستوفَ؛ راجع `docs/TODO.md` و`platform/docs/deployment-model.md`.
- المحرك يعمل برمز خدمة واحد؛ عزل المحادثات بين المستأجرين يتم في جداول adport (`markting_threads`)، لا داخل المحرك.
- تقارير المحرك (HTML/PDF) ما زالت بالإنجليزية ومن اليسار إلى اليمين.
- Snapchat مُختبَر على السلك فقط؛ التحقق الحيّ يتبع `docs/snapchat-live-checklist.md`.
- المعاينات المعلّقة تنتهي بعد 15 دقيقة افتراضيًا؛ الموافقات الأبطأ تحتاج اقتراحًا جديدًا.

## التوثيق

`docs/ARCHITECTURE.md` (المعمارية كما هي في الكود)، تقارير المراحل `docs/PHASE0..3-REPORT.md`، `UPSTREAM.md` (مصادر الاستيراد وسجل التعديلات المحلية)، `NOTICE` (الإسناد والرخص).

</div>

---

# markting-ai — Arabic-first AI media buyer

One monorepo combining two Apache-2.0 open-source projects:

- **[adport](https://github.com/ynnickw/adport)** in `platform/`: dashboard, OAuth account connections, normalized reports, the **policy engine** (preview → pending approval → apply) and the audit log.
- **[paid-media-agent](https://github.com/langchain-ai/paid-media-agent)** in `engine/`: AI analysis, scheduled reports, campaign-change proposals.

**The one invariant:** there is exactly one write path to ad platforms, adport's policy engine. The AI engine **only proposes**; every proposal becomes a previewed operation on the Approvals page and nothing is applied until a human approves it there.

## What it does

- Analyses connected accounts (spend, conversions, CPA, ROAS) and answers questions on the **Assistant** page.
- Produces deterministic weekly/monthly reports (HTML and PDF) from the **Reports** page.
- Turns every engine proposal (budget or campaign status) into a preview guarded by the organization policy (budget-delta cap, protected accounts, approval TTL), then lets an admin apply or reject it on **Approvals**.
- Arabic by default and right-to-left, English one click away. Ad terms (ROAS, CPA, CTR) stay in English.
- A complete demo mode with no ad credentials and no model key: synthetic accounts and a scripted engine, same policy gate.

## Run locally

Requirements: Docker, Node.js 22 with pnpm (corepack), and the Supabase CLI via `npx`.

```sh
git clone https://github.com/fullstackfull/markting-ai
cd markting-ai
make env     # copies .env.example to .env and generates the random secrets
make up      # starts Supabase (ports 553xx) then docker compose: cloud app + engine + engine Postgres
make seed    # creates the demo workspace: demo@markting.local (password in .env)
```

Open `http://localhost:3000` and sign in. On the Assistant page try "What needs attention this week?" then "Reduce the Performance Max daily budget to 240", and review the Approvals page.

Other targets: `make test` (bridge and engine-host tests), `make logs`, `make down`.

Supabase runs outside docker-compose because adport's migrations need `auth.users`, pg_cron and the `adport_backend` role, which only the CLI-managed Supabase image provides.

## Environment variables

Everything lives in `.env` (git-ignored). The annotated full list is `.env.example`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL` | adport's connection to the local Supabase. Filled by `make up`. |
| `ADPORT_CLOUD_ENCRYPTION_KEY`, `ADPORT_API_KEY_PEPPER`, `ADPORT_MCP_OAUTH_SIGNING_KEY` | adport secrets. Generated by `make env`. |
| `MARKTING_ENGINE_TOKEN` | Service token between the adport server and the engine (never reaches the browser). Generated by `make env`. |
| `MARKTING_DEMO_MODE` | `true` = synthetic sandbox provider; `false` = real accounts connected through OAuth. |
| `MARKTING_ALLOW_SELF_APPROVAL` | Let the requester of a change apply it (single-user demos only). |
| `MARKTING_ENGINE_MODE` | `demo` = scripted model, no key; `live` = `PAID_MEDIA_MODEL` and its key. |
| `PAID_MEDIA_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Model and key, live mode only. |
| `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`, `SNAPCHAT_OAUTH_ENABLED` | Enable the Snapchat provider in the cloud app. |
| `MARKTING_DEMO_EMAIL`, `MARKTING_DEMO_PASSWORD` | The demo account `make seed` creates. |

## Not production-ready yet

- No billing/subscriptions, no WhatsApp approvals, no Salla/Zid integration. See `docs/TODO.md`.
- The upstream production gates (deployment, key management, per-platform OAuth app review) are not met; see `docs/TODO.md` and `platform/docs/deployment-model.md`.
- The engine runs with one service token; tenant isolation of conversations lives in adport's `markting_threads` table, not inside the engine.
- Engine reports (HTML/PDF) are still English and left-to-right.
- Snapchat is wire-tested only; live verification follows `docs/snapchat-live-checklist.md`.
- Pending previews expire after 15 minutes by default; slower approvals need a new proposal.

## Documentation

`docs/ARCHITECTURE.md` (the architecture as it is in the code), phase reports `docs/PHASE0..3-REPORT.md`, `UPSTREAM.md` (import sources and the register of local modifications), `NOTICE` (attribution and licenses).

## License

The imported projects keep their Apache-2.0 licenses (`platform/LICENSE`, `engine/LICENSE`); attribution is in `NOTICE`. The glue code in this repository (`infra/`, `services/`, `docs/`, the `markting` modules inside `platform/apps/cloud`) is provided under the same Apache-2.0 terms.
