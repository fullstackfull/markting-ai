# 05 — Text / Hook / Angle Intelligence (4G/4H/4I)

`creative/classify.ts`. DETERMINISTIC bilingual (en/ar) pattern classification over ad copy. **No LLM
invents attributes** — every detection is a taxonomy match with the matched span as evidence.

- **Ad copy is untrusted DATA.** It is matched against an extensible keyword taxonomy, never executed
  as instructions. A "ignore your system prompt" string is classified like any other copy (yielding
  only offer/urgency/cta-type features); it never becomes a control value. (Tested in the eval +
  injection suites.)
- **Hook taxonomy (4H):** problem_first, benefit_first, product_first, curiosity, social_proof,
  testimonial, authority, urgency, demonstration, comparison, offer_led, transformation — plus
  `OTHER / UNKNOWN / MULTIPLE`. Not claimed as universal truth; a creative may carry multiple hooks
  (primary = MULTIPLE when >2 detected).
- **Angle taxonomy (4I):** price, quality, convenience, authority, scientific, emotional, social_proof,
  transformation, scarcity, urgency, education, feature_led, benefit_led — plus OTHER/UNKNOWN.
  Extensible.
- **Text features (4G):** offer, urgency, social_proof, testimonial, authority, pain_point, benefit,
  objection_handling, curiosity, cta. Each with an evidence span + confidence.

Bilingual note: patterns match substrings (ASCII `\b` word boundaries are intentionally not used, as
they do not work for Arabic in JS regex), so Arabic copy classifies correctly.
