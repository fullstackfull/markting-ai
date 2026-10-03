# 06 — Billing Operations (PARTIAL / roadmap)
Stripe subscription sync (webhook `customer.subscription.*`) and tenant billing page exist (discovery doc 04). No
operator revenue view, MRR/ARR/churn, failed-payment queue, or invoice access yet; `invoice.*`/
`checkout.session.completed` are still unhandled. `/admin/billing` is a PARTIAL stub. MRR formula (sum of active+
trialing+past_due monthly-equivalent plan price) and a failed-payment pipeline are specified for Wave 8; tax/VAT/SAR
is explicitly NOT implemented and must be shown as such, never faked.
