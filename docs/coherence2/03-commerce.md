# 03 — Commerce / Profit — DONE

`app/dashboard/commerce` + the account drill-down render the commerce section computed by the real
engines: merchant net revenue, refund rate, MER (`computeMER`, merchant-sourced only), contribution
margin (`computeMargin`), platform-vs-merchant reconciliation (`reconcile`, with sampleSufficiency), and
AOV change. **Profit is withheld as UNKNOWN when COGS is unknown — never inferred from price.** One
seeded client has COGS unknown to prove the UNKNOWN path. Cross-domain profit diagnosis (Program 7) is
answerable via PROFITABILITY_DECLINE composing commerce + media + creative.
