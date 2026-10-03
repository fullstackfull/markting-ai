/**
 * Phase 4G/4H/4I — creative TEXT, HOOK, and ANGLE intelligence. DETERMINISTIC pattern classification
 * over ad copy (bilingual en/ar). Ad copy is untrusted DATA: it is matched against an extensible
 * taxonomy, never executed as instructions, and no attribute is invented that is not evidenced by a
 * matched span. Each detection carries its evidence span + confidence. The taxonomies are NOT claimed
 * as universal truth — OTHER/UNKNOWN/MULTIPLE are first-class.
 */
import type { CreativeText } from './model';

export const HOOK_TYPES = ['problem_first', 'benefit_first', 'product_first', 'curiosity', 'social_proof', 'testimonial', 'authority', 'urgency', 'demonstration', 'comparison', 'offer_led', 'transformation', 'OTHER', 'UNKNOWN', 'MULTIPLE'] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const ANGLE_TYPES = ['price', 'quality', 'convenience', 'authority', 'scientific', 'emotional', 'social_proof', 'transformation', 'scarcity', 'urgency', 'education', 'feature_led', 'benefit_led', 'OTHER', 'UNKNOWN'] as const;
export type AngleType = (typeof ANGLE_TYPES)[number];

export const TEXT_FEATURES = ['offer', 'urgency', 'social_proof', 'testimonial', 'authority', 'pain_point', 'benefit', 'objection_handling', 'curiosity', 'cta'] as const;
export type TextFeature = (typeof TEXT_FEATURES)[number];

export interface Detection<T extends string> { value: T; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; evidence: string[] }

/** Bilingual keyword patterns. Deterministic; extend freely — this is not universal truth. */
const HOOK_PATTERNS: Partial<Record<HookType, RegExp>> = {
  problem_first: /(struggling|tired of|problem|can't|frustrat|مشكلة|تعاني|سئمت|متعب)/i,
  benefit_first: /(get|unlock|boost|save|grow|achieve|احصل|وفّر|ضاعف|حقّق)/i,
  product_first: /(introducing|new|meet the|our (new )?product|جديد|تعرّف على|منتجنا)/i,
  curiosity: /(secret|you won'?t believe|what if|did you know|سرّ|لن تصدّق|هل تعلم|ماذا لو)/i,
  social_proof: /(\d[\d,]*\+? (customers|users|people)|join|trusted by|انضم|يثق بنا|آلاف العملاء)/i,
  testimonial: /(".*"|“.*”|i (love|tried)|my experience|review|شهادة|تجربتي|أحببت)/i,
  authority: /(experts?|doctors?|certified|#1|award|خبراء|أطباء|معتمد|الأفضل)/i,
  urgency: /(now|today|hurry|last chance|ends|الآن|اليوم|أسرع|ينتهي|آخر فرصة)/i,
  demonstration: /(how to|watch|see how|step by step|كيف|شاهد|خطوة بخطوة)/i,
  comparison: /(vs\.?|better than|compared to|unlike|مقابل|أفضل من|مقارنة)/i,
  offer_led: /(\d+% off|sale|discount|free|deal|offer|خصم|مجان|عرض|تخفيض)/i,
  transformation: /(before (and|&) after|transform|from .* to|results|قبل وبعد|تحوّل|من .* إلى|نتائج)/i,
};
const ANGLE_PATTERNS: Partial<Record<AngleType, RegExp>> = {
  price: /(cheap|affordable|lowest price|save money|رخيص|بأسعار|وفّر)/i,
  quality: /(premium|high.?quality|best|durable|فاخر|جودة|الأفضل|متين)/i,
  convenience: /(easy|fast|simple|hassle.?free|سهل|سريع|بسيط|دون عناء)/i,
  scientific: /(clinically|study|proven|research|سريري|دراسة|مثبت علمي|أبحاث)/i,
  emotional: /(love|feel|happy|confidence|dream|حب|تشعر|سعادة|ثقة|حلم)/i,
  social_proof: /(bestsell|popular|everyone|trending|الأكثر مبيع|شائع|الجميع|رائج)/i,
  scarcity: /(limited|only \d+ left|while stocks|محدود|الكمية|نفاد)/i,
  urgency: /(now|today|hurry|الآن|اليوم|أسرع)/i,
  education: /(learn|guide|how to|tips|تعلّم|دليل|نصائح|كيف)/i,
  feature_led: /(features?|includes?|built.?in|مواصفات|يتضمّن|مدمج)/i,
  benefit_led: /(so you can|helps you|benefit|لكي|يساعدك|فائدة)/i,
};
const FEATURE_PATTERNS: Partial<Record<TextFeature, RegExp>> = {
  offer: /(\d+% off|free|discount|deal|خصم|مجان|عرض)/i,
  urgency: /(now|today|last chance|ends soon|الآن|اليوم|آخر فرصة)/i,
  social_proof: /(\d[\d,]*\+? (customers|reviews)|trusted|يثق|عميل|تقييم)/i,
  testimonial: /(".*"|“.*”|my experience|تجربتي|شهادة)/i,
  authority: /(experts?|certified|#1|خبراء|معتمد)/i,
  pain_point: /(tired of|struggling|problem|تعاني|مشكلة|سئمت)/i,
  benefit: /(get|save|boost|grow|احصل|وفّر|ضاعف)/i,
  objection_handling: /(no risk|money.?back|guarantee|cancel anytime|بلا مخاطر|ضمان|استرداد)/i,
  curiosity: /(secret|what if|سرّ|ماذا لو)/i,
  cta: /(shop now|buy|sign up|learn more|get started|اشترِ|سجّل|اطلب|ابدأ)/i,
};

function corpus(text?: CreativeText): string {
  if (!text) return '';
  return [text.headline, text.primaryText, text.description, text.cta].filter(Boolean).join(' \n ');
}

function detectAll<T extends string>(text: string, patterns: Partial<Record<T, RegExp>>): Array<Detection<T>> {
  const out: Array<Detection<T>> = [];
  for (const [value, re] of Object.entries(patterns) as Array<[T, RegExp]>) {
    const m = text.match(re);
    if (m) out.push({ value, confidence: 'MEDIUM', evidence: [m[0]] });
  }
  return out;
}

export interface CreativeTextClassification {
  hooks: Array<Detection<HookType>>;
  primaryHook: HookType;
  angles: Array<Detection<AngleType>>;
  features: Array<Detection<TextFeature>>;
  hasText: boolean;
}

export function classifyCreativeText(text?: CreativeText): CreativeTextClassification {
  const c = corpus(text);
  if (!c.trim()) return { hooks: [], primaryHook: 'UNKNOWN', angles: [], features: [], hasText: false };
  const hooks = detectAll<HookType>(c, HOOK_PATTERNS);
  const angles = detectAll<AngleType>(c, ANGLE_PATTERNS);
  const features = detectAll<TextFeature>(c, FEATURE_PATTERNS);
  const primaryHook: HookType = hooks.length === 0 ? 'OTHER' : hooks.length > 2 ? 'MULTIPLE' : hooks[0]!.value;
  return { hooks, primaryHook, angles, features, hasText: true };
}
