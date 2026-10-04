import 'server-only';
import type { GatewayUsage, ModelDescriptor, ModelRole } from '../ai-gateway';

/**
 * PHASE C.6 (31) — AI PROVIDER ADAPTER PREP (credential-free).
 *
 * A provider-neutral port that sits UNDER the governed AiGateway: it maps one governed, read/analysis
 * model request to a NORMALIZED completion result, so a LiteLLM-or-equivalent backend can slot behind it
 * later without changing callers. It ships NO SDK and makes NO network/live model call. Two concrete
 * adapters exist: a deterministic `FakeAIProviderAdapter` (canned/echo, recorded free) for tests, and a
 * `BlockedExternalAIProviderAdapter` stub that implements the port but throws a BLOCKED_EXTERNAL marker if
 * ever called. Per-provider descriptors are DOCUMENTATION_DERIVED metadata only (no secrets).
 *
 * READ/ANALYSIS-ONLY INVARIANT: the request type carries only text to analyze/summarize/report. There is
 * deliberately NO field that can represent a provider write/action verb — writes remain unreachable here,
 * exactly as in the AiGateway seam this sits under.
 */

/** A BLOCKED_EXTERNAL marker: raised by any stub that would otherwise talk to a real provider. */
export class BlockedExternalError extends Error {
  readonly blockedExternal = true as const;
  constructor(message: string) {
    super(`BLOCKED_EXTERNAL: ${message}`);
    this.name = 'BlockedExternalError';
  }
}

export function isBlockedExternal(e: unknown): e is BlockedExternalError {
  return e instanceof BlockedExternalError || (e instanceof Error && e.message.startsWith('BLOCKED_EXTERNAL:'));
}

/**
 * A governed completion request. It is read/analysis-only: `system`/`input` are DATA to reason over, never
 * an instruction to act on a provider. There is no action/write/tool-call verb representable here.
 */
export interface AICompletionRequest {
  role: ModelRole;
  /** The model the gateway resolved for the role (provider + model id). */
  model: ModelDescriptor;
  /** Optional analysis framing (treated as data, not a control channel). */
  system?: string;
  /** The text to analyze / summarize / report over. */
  input: string;
  /** Soft cap on output tokens (advisory for the backend; the fake ignores it). */
  maxOutputTokens?: number;
}

export type AIFinishReason = 'stop' | 'length' | 'refusal' | 'content_filter' | 'local_fallback';

/** The normalized shape every adapter returns — provider detail collapsed to a stable contract. */
export interface AINormalizedCompletion {
  text: string;
  usage: GatewayUsage;
  finishReason: AIFinishReason;
  provider: string;
  model: string;
  /** True when produced without a live model (scripted/free); never a fabricated real result. */
  localFallback: boolean;
}

/** The provider-neutral port. A backend implements `complete`; nothing here performs I/O by contract. */
export interface AIProviderAdapter {
  readonly provider: string;
  readonly descriptor: AIProviderDescriptor;
  complete(req: AICompletionRequest): Promise<AINormalizedCompletion>;
}

// ---- per-provider descriptors (DOCUMENTATION_DERIVED metadata only; no secrets, no live lookup) ----
export interface AIProviderDescriptor {
  provider: string;
  /** Provenance marker: these numbers come from public docs, not a live capabilities call. */
  source: 'DOCUMENTATION_DERIVED';
  /** Model id used per role. */
  modelByRole: Record<ModelRole, string>;
  /** Context window (tokens) per model id. */
  contextWindowTokens: Record<string, number>;
  /** Micros of billing currency per 1k input/output tokens, by model id (estimate only). */
  pricePer1kMicros: Record<string, { input: number; output: number }>;
}

/** The scripted/demo provider — free, local, the default allowlisted provider. */
export const SCRIPTED_DESCRIPTOR: AIProviderDescriptor = {
  provider: 'scripted',
  source: 'DOCUMENTATION_DERIVED',
  modelByRole: { FAST_ANALYSIS: 'scripted-demo', DEEP_ANALYSIS: 'scripted-demo', REPORT_GENERATION: 'scripted-demo' },
  contextWindowTokens: { 'scripted-demo': 200_000 },
  pricePer1kMicros: { 'scripted-demo': { input: 0, output: 0 } },
};

export const ANTHROPIC_DESCRIPTOR: AIProviderDescriptor = {
  provider: 'anthropic',
  source: 'DOCUMENTATION_DERIVED',
  modelByRole: {
    FAST_ANALYSIS: 'claude-haiku',
    DEEP_ANALYSIS: 'claude-sonnet',
    REPORT_GENERATION: 'claude-sonnet',
  },
  contextWindowTokens: { 'claude-haiku': 200_000, 'claude-sonnet': 200_000 },
  pricePer1kMicros: { 'claude-haiku': { input: 800, output: 4000 }, 'claude-sonnet': { input: 3000, output: 15_000 } },
};

export const OPENAI_DESCRIPTOR: AIProviderDescriptor = {
  provider: 'openai',
  source: 'DOCUMENTATION_DERIVED',
  modelByRole: { FAST_ANALYSIS: 'gpt-mini', DEEP_ANALYSIS: 'gpt-main', REPORT_GENERATION: 'gpt-main' },
  contextWindowTokens: { 'gpt-mini': 128_000, 'gpt-main': 128_000 },
  pricePer1kMicros: { 'gpt-mini': { input: 150, output: 600 }, 'gpt-main': { input: 2500, output: 10_000 } },
};

export const PROVIDER_DESCRIPTORS: Record<string, AIProviderDescriptor> = {
  scripted: SCRIPTED_DESCRIPTOR,
  anthropic: ANTHROPIC_DESCRIPTOR,
  openai: OPENAI_DESCRIPTOR,
};

export function descriptorFor(provider: string): AIProviderDescriptor | undefined {
  return PROVIDER_DESCRIPTORS[provider];
}

/**
 * A deterministic test adapter. By default it ECHOES the input (prefixed with the provider) and reports
 * NO tokens, so it is recorded free through the gateway. Canned responses keyed by `input` override the
 * echo for fixture-driven tests. Optional `fail` makes it throw a given error, for failover tests.
 */
export class FakeAIProviderAdapter implements AIProviderAdapter {
  readonly provider: string;
  readonly descriptor: AIProviderDescriptor;
  private readonly canned: Record<string, string>;
  private readonly fail?: () => Error;
  private readonly finishReason: AIFinishReason;

  constructor(opts: {
    provider?: string;
    descriptor?: AIProviderDescriptor;
    canned?: Record<string, string>;
    fail?: () => Error;
    finishReason?: AIFinishReason;
  } = {}) {
    this.provider = opts.provider ?? opts.descriptor?.provider ?? 'scripted';
    this.descriptor = opts.descriptor ?? descriptorFor(this.provider) ?? SCRIPTED_DESCRIPTOR;
    this.canned = opts.canned ?? {};
    this.fail = opts.fail;
    this.finishReason = opts.finishReason ?? 'stop';
  }

  async complete(req: AICompletionRequest): Promise<AINormalizedCompletion> {
    if (this.fail) throw this.fail();
    const text = this.canned[req.input] ?? `[fake:${this.provider}] ${req.input}`;
    return {
      text,
      usage: { tokensAvailable: false },
      finishReason: this.finishReason,
      provider: this.provider,
      model: req.model.model,
      localFallback: true,
    };
  }
}

/**
 * The real-provider seam, DISABLED by construction. It implements the port and ships no SDK/HTTP client;
 * `complete` throws a BLOCKED_EXTERNAL marker so no live model call can happen credential-free. Production
 * would replace the body with a governed backend call — nothing here is ever invoked autonomously.
 */
export class BlockedExternalAIProviderAdapter implements AIProviderAdapter {
  readonly provider: string;
  readonly descriptor: AIProviderDescriptor;
  constructor(descriptor: AIProviderDescriptor) {
    this.provider = descriptor.provider;
    this.descriptor = descriptor;
  }
  async complete(_req: AICompletionRequest): Promise<AINormalizedCompletion> {
    throw new BlockedExternalError(`live provider '${this.provider}' not wired (no SDK, no credentials)`);
  }
}
