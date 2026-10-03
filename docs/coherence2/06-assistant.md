# 06 — Assistant & Orchestrator — DONE

- The Assistant answers the full benchmark through ONE orchestrator: a deterministic bilingual
  question→intent router (18 analytical intents) maps each question to a REAL computation (a section or
  the composed diagnosis), not a per-question keyword hack. `runAssistantTurn` falls back to the
  orchestrator when the external engine is unreachable (the no-engine/demo case), so "Ask AI" answers
  via the unified path; the governed budget-proposal bridge is untouched when an engine is present.
- Honest answer source: LIVE_MODEL / LOCAL_FALLBACK / DETERMINISTIC_ONLY; today DETERMINISTIC_ONLY (no
  governed model — BLOCKED_EXTERNAL). Every material claim carries inspectable evidence; no hidden
  chain-of-thought.
- Follow-up context (Program 17): intents + the account/campaign scope ride in the server-derived
  context, never model memory for identity. A full multi-turn conversational memory of prior entities is
  PARTIAL (the context object supports it; the chat UI does not yet thread it).
