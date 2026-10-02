export const meta = {
  name: 'markting-ai-audit-council',
  description: 'Final council of the audit: cross-team verdicts, red-team reconciliation, findings register, roadmap, executive summary and final verdict under docs/audit',
  phases: [
    { title: 'Council', detail: 'eight council seats + red-team reconciliation + findings register' },
    { title: 'Synthesis', detail: 'roadmap and executive summary' },
    { title: 'Verdict', detail: 'final council verdict' },
  ],
}

const ROOT = '/home/user/markting-ai'
const OUT = `${ROOT}/docs/audit/agents`
const AUD = `${ROOT}/docs/audit`

const RULES = `
You are a member of the FINAL COUNCIL of a forensic, evidence-based audit of the repository at ${ROOT} (an Arabic-first "AI media buyer" SaaS built from two vendored Apache-2.0 projects: adport in platform/ and paid-media-agent in engine/, plus glue in services/, infra/, docs/, and the markting modules inside platform/apps/cloud).

NON-NEGOTIABLE RULES
- This is an AUDIT. Do not implement, refactor, fix, or delete anything. You may write ONLY the files named in your workstream (under ${AUD}/). Never touch any other file. Never modify git state.
- Repository code is the source of truth. README.md, UPSTREAM.md, docs/*.md, phase reports, previous summaries AND the other agents' reports are claims to VERIFY. Spot-check citations in code before relying on them; when an agent's citation does not hold, say so and downgrade it.
- Every significant conclusion carries evidence (path:line relative to ${ROOT}, or a command actually run with exit code) and a classification tag: VERIFIED_CODE, VERIFIED_TEST, VERIFIED_RUNTIME, DOCUMENTED_ONLY, INFERRED, NOT_VERIFIED. Never upgrade an inference to a fact. Never claim runtime verification for commands not actually run.
- Severity: P0 (security / data loss / cross-tenant / unsafe ad execution), P1 (production blocker or serious financial risk), P2 (substantial functional or reliability deficiency), P3 (quality / polish). Do not inflate. A missing feature is a GAP, not a defect, unless the code claims to provide it.
- Inputs: specialist and lead reports in ${OUT}/*.md (A*, B*, C*, D*, E*, F*, G*, H*, I*, J*), team deliverables ${AUD}/01..10 and ${AUD}/_business-and-pricing-architecture.md, and the workflow result dumps ${OUT}/_results-*.json (structured findings per agent). Some agents may have failed and left no report: record that as a coverage gap instead of inventing content.
- Read-only commands are allowed (rg, cat, sed -n, find, wc, git log). Do not run builds or test suites unless your workstream says so.
- Write in English with clear structure; every document begins with a one-paragraph "How to read this" and a classification legend.
`

const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string' }, title: { type: 'string' },
    severity: { type: 'string', description: 'P0|P1|P2|P3|GAP' },
    classification: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' }, recommendation: { type: 'string' },
  },
  required: ['id', 'title', 'severity', 'classification', 'evidence', 'description', 'recommendation'],
}
const RESULT = {
  type: 'object',
  properties: {
    seat: { type: 'string' }, report_path: { type: 'string' },
    files_written: { type: 'array', items: { type: 'string' } },
    spot_checks: { type: 'array', items: { type: 'string' }, description: 'citation => HELD|FAILED|PARTIAL' },
    findings: { type: 'array', items: FINDING, description: 'final findings this seat vouches for' },
    severity_counts: { type: 'object', properties: { P0: { type: 'number' }, P1: { type: 'number' }, P2: { type: 'number' }, P3: { type: 'number' }, GAP: { type: 'number' } }, required: ['P0', 'P1', 'P2', 'P3', 'GAP'] },
    contradictions: { type: 'array', items: { type: 'string' }, description: 'unresolved disagreements between agents, with the code evidence for each side' },
    not_verified: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['seat', 'report_path', 'files_written', 'spot_checks', 'findings', 'severity_counts', 'contradictions', 'not_verified', 'confidence', 'summary'],
}

const SEATS = [
  { id: 'K1', role: 'Head of Paid Media', inputs: 'A1–A16 reports, 01 and 09, and J1–J6', ask: `Judge whether the platform can act as a media buyer today: for each row of ${AUD}/09-media-buyer-capability-matrix.md confirm or correct the cell with code evidence (spot-check at least 15 cells across providers). Rule on the question "dashboard with an AI chat layer OR intelligent media-buying OS" from capabilities only. List the top 10 product gaps in priority order with the evidence for each.` },
  { id: 'K2', role: 'Chief AI Architect', inputs: 'C1–C14 reports, 02 and 03, E6, J reports on AI bypass', ask: `Rule on the AI layer: what is real, what is scripted/mock, what is structurally missing. Spot-check 15 citations. Confirm or correct the verdict on the "AI may only propose" invariant with every bypass attempt's outcome. List the top 10 AI gaps in priority order and the recommended target AI architecture (gateway, intelligence layer, memory, recommendation pipeline, outcome loop) as decisions with rationale, not implementation.` },
  { id: 'K3', role: 'Principal Architect', inputs: 'D0–D11 reports and 04, plus H reports', ask: `Validate ${AUD}/04-system-architecture-map.md against the code (spot-check every Mermaid diagram's edges: 15+ checks). Rule on duplicated responsibilities, coupling, single points of failure, scaling and migration risk. Recommend the Phase 0 architecture decisions that everything else depends on.` },
  { id: 'K4', role: 'Security Lead', inputs: 'E1–E11 reports and 05, J1–J6 (independent red team)', ask: `Re-adjudicate every P0 and P1 security finding by reading the cited code yourself; demote or confirm each with reasoning. Produce the authoritative 15-invariant table (adport only writer; engine cannot bypass; every write requires preview; preview/apply cannot differ; policy re-checked at apply; tenant isolation; engine conversation isolation; token encryption; no provider creds in browser; currency/budget units; TTL enforced; no duplicate/replay approval; audit cannot omit writes; demo cannot affect prod; MARKTING_ENGINE_TOKEN no cross-tenant) with HOLDS/PARTIAL/BROKEN + evidence. Record where the red team (J) disagrees with E and resolve with code.` },
  { id: 'K5', role: 'Data Scientist', inputs: 'B1–B9 reports, 10, A12/A13/A15', ask: `Rule on the trustworthiness of every number the product shows or the AI reasons over: metric definitions, currency/unit handling, attribution gaps, sample sufficiency. Spot-check 10 citations. Define the minimum data-trust requirements before any recommendation may carry a confidence score.` },
  { id: 'K6', role: 'QA Lead', inputs: 'F1–F9 reports and 06, plus every "Commands executed" section of all agents', ask: `Compile the authoritative list of commands/tests actually executed during this audit (deduplicated, verbatim, with exit codes, taken only from agents' "Commands executed" sections and tests_executed fields) and what they prove. Then list the regression scenarios the critical chain (proposal → preview → approval → apply → audit) lacks, each mapped to existing tests or MISSING. Do not treat green suites as readiness.` },
  { id: 'K7', role: 'Product Lead', inputs: 'G1–G7 reports, 07, I1–I5 and _business-and-pricing-architecture.md', ask: `Rule on persona fit, onboarding, Arabic quality, and the AI Media Buyer Workbench proposal. Separate "must exist before first paying customer" from "differentiator later". Record the pricing/entitlement open decisions without deciding them.` },
  { id: 'K8', role: 'SRE Lead', inputs: 'H1–H7 reports, 08, F reports on CI, E reports on secrets', ask: `Produce the authoritative production-readiness blocker list (blockers vs should-haves), each with evidence and classification, and the explicit list of what this sandbox could NOT verify (Docker image builds, live Stripe, live OAuth, live model mode, real Supabase project, etc.). Spot-check 10 citations.` },
]

function seatPrompt(s) {
  return `${RULES}\nYOUR SEAT: ${s.id} — ${s.role}\nPRIMARY INPUTS: ${s.inputs} (read them under ${OUT}/ and ${AUD}/).\n\nWORKSTREAM:\n${s.ask}\n\nWrite your council memo to ${OUT}/${s.id}.md with sections: Inputs read; Spot-checks (citation => HELD/FAILED/PARTIAL); Verdicts; Findings you vouch for (final severities); Contradictions between agents and how you resolved them (or "unresolved" with both sides' evidence); What was NOT verified; Confidence. Return the structured JSON.`
}

const REDTEAM = `${RULES}\nYOUR SEAT: K9 — Red-team reconciliation.\nRead J1–J6 (independent red team, written without reading A–I) and compare with the A–I specialist and lead reports and ${AUD}/01..10. Produce ${OUT}/K9.md: (1) findings J found that no A–I agent found, (2) findings A–I found that J missed, (3) direct contradictions with both sides' evidence and your resolution from code (spot-check every contradiction yourself), (4) the J-only P0/P1 list re-adjudicated. Return the structured JSON (contradictions = the unresolved ones).`

const REGISTER = `${RULES}\nYOUR SEAT: K10 — Findings register writer.\nWrite ${AUD}/11-agent-findings-register.md: ONE ROW PER AGENT for every agent id that appears in ${OUT}/*.md or ${OUT}/_results-*.json (teams A–J, leads, and the council seats K1–K9 if their memos exist), columns: Agent ID | Role | Scope | Files inspected (count + key paths) | Tests/commands run | Key findings (3 max, one line each) | P0 | P1 | P2 | P3 | Confidence | Disagreements. Agents with no report: a row stating "NO REPORT (agent failed)". After the table: team subtotals and the grand total of P0/P1/P2/P3/GAP computed from the per-agent rows (show the arithmetic), and a deduplication note listing findings reported by more than one agent (same path:line or same defect) with the canonical ID kept. Also write a machine-readable copy of the totals and the dedup list to ${AUD}/agents/_register-totals.json. Return the structured JSON (severity_counts = the deduplicated grand total).`

const ROADMAP = (ctx) => `${RULES}\nYOUR SEAT: K11 — Roadmap writer.\nCouncil memos K1–K9 are in ${OUT}/K*.md; the register is ${AUD}/11-agent-findings-register.md. Council summaries:\n${ctx}\n\nWrite ${AUD}/12-roadmap.md: Phases 0–7 ordered strictly by dependency (Phase 0 = what everything depends on: safety invariants, architecture decisions, data trust, CI/verification; later phases: production hardening, AI gateway, intelligence layer, recommendation engine, outcome loop, workbench, scale/agency/enterprise). Each item: ID (R0-01…), problem, why it matters, dependencies (item IDs), files/subsystems affected, architecture impact, security impact, data migration impact, test requirements, complexity (S/M/L/XL), acceptance criteria. NO dates and NO effort-in-days. Every item traces to finding IDs from the register or to an explicit product decision. End with an "Open decisions for the owner" list. Return the structured JSON (findings may be empty; summary = Phase 0 in ten lines).`

const EXEC = (ctx) => `${RULES}\nYOUR SEAT: K12 — Executive summary writer.\nRead ${AUD}/01..12, ${AUD}/_business-and-pricing-architecture.md, the council memos ${OUT}/K*.md and ${AUD}/agents/_register-totals.json. Council summaries:\n${ctx}\n\nWrite ${AUD}/00-executive-summary.md (3–5 pages): what the system IS today (one paragraph, evidence-based); the answer to "dashboard with AI chat layer OR intelligent media-buying OS"; P0/P1/P2/P3 totals (from the register, deduplicated); top 10 risks; top 10 product gaps; top 10 AI gaps; production-readiness blockers; recommended Phase 0; recommended AI architecture (decisions); contradictory findings needing the owner's resolution; exact statement of what was NOT verified in this sandbox; the audit's own method and limits (agent count, coverage gaps, agents that failed). Every list item cites a finding ID or path:line. Return the structured JSON (summary = the one-paragraph verdict).`

const VERDICT = (ctx) => `${RULES}\nYOUR SEAT: K13 — Final council verdict.\nRead ${AUD}/00-executive-summary.md, ${AUD}/12-roadmap.md and the council memos ${OUT}/K*.md. Council summaries:\n${ctx}\n\nWrite ${AUD}/13-final-council-verdict.md: for each council seat (Head of Paid Media, Chief AI Architect, Principal Architect, Security Lead, Data Scientist, QA Lead, Product Lead, SRE Lead) a signed-style verdict paragraph with GO / NO-GO for (a) continued development on this architecture, (b) accepting a first paying customer now, (c) enabling live writes to real ad accounts now; then the consolidated verdict, the conditions under which each NO-GO becomes GO (traced to roadmap item IDs), the dissenting opinions kept verbatim, and the statement that no implementation was performed during this audit. Return the structured JSON.`

phase('Council')
const council = {}
await parallel([
  ...SEATS.map((s) => async () => { council[s.id] = await agent(seatPrompt(s), { label: `${s.id}:${s.role}`, phase: 'Council', schema: RESULT, effort: 'high' }); log(`${s.id} done`) }),
  async () => { council.K9 = await agent(REDTEAM, { label: 'K9:Red-team reconciliation', phase: 'Council', schema: RESULT, effort: 'high' }); log('K9 done') },
  async () => { council.K10 = await agent(REGISTER, { label: 'K10:Findings register', phase: 'Council', schema: RESULT, effort: 'high' }); log('K10 done') },
])

const ctx = Object.entries(council).filter(([, r]) => r).map(([id, r]) => `- ${id}: ${r.summary} | P0=${r.severity_counts.P0} P1=${r.severity_counts.P1} P2=${r.severity_counts.P2} P3=${r.severity_counts.P3} | contradictions: ${r.contradictions.join(' || ') || 'none'}`).join('\n')
log(`council seats completed: ${Object.values(council).filter(Boolean).length}/10`)

phase('Synthesis')
const roadmap = await agent(ROADMAP(ctx), { label: 'K11:Roadmap', phase: 'Synthesis', schema: RESULT, effort: 'high' })
const exec = await agent(EXEC(ctx), { label: 'K12:Executive summary', phase: 'Synthesis', schema: RESULT, effort: 'high' })

phase('Verdict')
const verdict = await agent(VERDICT(ctx), { label: 'K13:Final verdict', phase: 'Verdict', schema: RESULT, effort: 'high' })

return { council, roadmap, exec, verdict }
