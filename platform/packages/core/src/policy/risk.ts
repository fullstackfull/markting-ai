import type { WriteOperation } from '../provider.js';

/**
 * Semantic risk class of a write, derived from the operation itself, independent of provider.
 * This mirrors the engine-side (paid-media-agent) risk classification on the adport write path
 * so that a generic, untyped API passthrough cannot smuggle a high-risk mutation past the rails
 * that a typed operation would face.
 */
export type RiskClass =
  | 'budget' // changes spend (daily/lifetime budget, bid)
  | 'status' // enable/pause/activate (starts or stops delivery)
  | 'targeting' // audience/placement/targeting changes
  | 'create' // creates a new object
  | 'destructive' // deletes/removes an object
  | 'generic' // an untyped API passthrough whose effect is not semantically classified
  | 'other';

/** A generic, untyped provider passthrough tool, e.g. `meta_api_update`, `google_api_remove`. */
const GENERIC_API_TOOL = /_api_(create|update|delete|remove)$/;
const GENERIC_DESTRUCTIVE = /_api_(delete|remove)$/;
const GENERIC_CREATE = /_api_create$/;

export function isGenericApiTool(tool: string): boolean {
  return GENERIC_API_TOOL.test(tool);
}

export function classifyWriteRisk(op: WriteOperation): RiskClass {
  const tool = op.tool;
  if (GENERIC_DESTRUCTIVE.test(tool)) return 'destructive';
  if (GENERIC_CREATE.test(tool)) return 'create';
  if (GENERIC_API_TOOL.test(tool)) return 'generic'; // _api_update: untyped mutation
  if (op.kind === 'create') return 'create';
  if (op.kind === 'remove') return 'destructive';
  if (/budget|bid/i.test(tool)) return 'budget';
  if (/status|pause|enable|activate|resume/i.test(tool)) return 'status';
  if (/target|audience|placement/i.test(tool)) return 'targeting';
  return 'other';
}
