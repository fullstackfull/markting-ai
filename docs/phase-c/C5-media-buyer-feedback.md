# C.5 (13) — Media-buyer pilot feedback (structured)

Collected from the design-partner media buyer at Stage 2 (daily diagnosis) and again at Stage 3 (if AI
narration is enabled). One form per account per review. Answers feed the pilot go/no-go and the realistic
product-bar assessment — they are not marketing copy.

For each diagnosis / recommendation reviewed:

1. **Is the diagnosis correct?** (Yes / Partly / No) — and what, specifically, was wrong?
2. **Did it save time** versus doing the same analysis by hand? (Yes / No / Unsure) — roughly how long?
3. **Was the evidence clear** and sufficient to trust the claim without re-checking? (Yes / Partly / No)
4. **What still required opening the native Ads Manager?** (free text — the gaps that block standalone use)
5. **Which metrics were missing** that you needed for this decision? (free text)
6. **Which recommendation was useful?** (identifier + why)
7. **Which recommendation was wrong or misleading?** (identifier + why — these are the most important)
8. **Would you use it tomorrow** for this account, as-is? (Yes / Only alongside native / No) — why?

Scoring notes:
- Any "No" on #1 (correctness) or a wrong recommendation on #7 is a **blocker** — root-cause before the
  pilot advances; if it stems from a data/attribution error, it is also an abort criterion.
- #4 and #5 are the honest capability gaps; they feed `C5` next-steps and the realistic product bar, and
  must not be papered over.
- Feedback is recorded verbatim (no summarizing away the negatives) and linked to the pilot incident/
  review log.
