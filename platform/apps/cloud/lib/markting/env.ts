import 'server-only';
import { z } from 'zod';

/**
 * markting-ai bridge settings. Parsed separately from `@/lib/env` so the upstream schema stays
 * untouched (its `z.object` strips unknown keys, so these values would otherwise be invisible).
 */
const schema = z.object({
  /** Base URL of the engine host, reachable from the cloud server only (never the browser). */
  MARKTING_ENGINE_URL: z.string().url().default('http://127.0.0.1:8080'),
  /** The token half of the engine's `PAID_MEDIA_API_TOKENS=<token>:<caller>` pair. */
  MARKTING_ENGINE_TOKEN: z.string().min(8).optional(),
  /** `true` enables the credential-free sandbox provider and alias map for previews. */
  MARKTING_DEMO_MODE: z.enum(['true', 'false']).default('false'),
  /** Allow the user who created a pending operation to apply it. Off by default. */
  MARKTING_ALLOW_SELF_APPROVAL: z.enum(['true', 'false']).default('false'),
  /** Upper bound for one synchronous engine chat call, in milliseconds. */
  MARKTING_ENGINE_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(900_000).default(240_000),
});

export type MarktingEnv = z.infer<typeof schema>;
let parsed: MarktingEnv | undefined;

export function marktingEnv(): MarktingEnv {
  parsed ??= schema.parse(process.env);
  return parsed;
}

export function isDemoMode(): boolean { return marktingEnv().MARKTING_DEMO_MODE === 'true'; }

export function resetMarktingEnvForTests(): void { parsed = undefined; }
