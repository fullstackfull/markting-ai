import { promises as fs } from 'node:fs';
import path from 'node:path';
import { adportHome } from '../paths.js';
import type { WriteOperation, WritePreview, WriteResult } from '../provider.js';
import type { ApplyActor } from './actor.js';

/**
 * Lifecycle of a previewed write. A pending operation is created `pending` at validate,
 * atomically claimed to `applying` at apply (exactly one claimant), then resolved to a
 * terminal state. `superseded` means live state diverged from the approved preview and a
 * fresh preview is required; `rejected` means a human rejected it without applying.
 */
export type PendingState =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'superseded'
  | 'rejected'
  | 'expired';

export interface PendingOperation {
  id: string;
  provider: string;
  opHash: string;
  op: WriteOperation;
  preview: WritePreview;
  /** Digest of the material fields of the approved preview; compared at apply (R0-06). */
  previewDigest?: string;
  createdAt: string;
  expiresAt: string;
  state?: PendingState;
  /** Actor that requested (validated) this operation. */
  requestedBy?: ApplyActor;
  /** Actor that approved (claimed to apply) this operation. */
  approvedBy?: ApplyActor;
  /** Stored provider result once applied, for idempotent replay. */
  result?: WriteResult;
}

/**
 * Result of an atomic claim attempt. Exactly one concurrent claimant of a `pending` row gets
 * `claimed`; everyone else gets a terminal status describing the row's current state. `applied`
 * returns the stored result so a retried apply is an idempotent no-op rather than a second write.
 */
export type ClaimResult =
  | { status: 'claimed'; pending: PendingOperation }
  | { status: 'not_found' }
  | { status: 'expired'; pending: PendingOperation }
  | { status: 'in_progress' }
  | { status: 'already_applied'; result?: WriteResult }
  | { status: 'superseded' }
  | { status: 'rejected' };

/** Persistence contract used by the policy engine in local and hosted runtimes. */
export interface PendingOperationStore {
  put(op: PendingOperation): Promise<void>;
  get(id: string): Promise<PendingOperation | undefined>;
  /**
   * Atomically transition `pending` (or a previously `failed` retry) → `applying` and return the
   * row. The hosted (Postgres) store does this with a single compare-and-set UPDATE … RETURNING so
   * two concurrent applies cannot both proceed; the file store is single-writer (local CLI only).
   */
  claim(id: string, approver: ApplyActor): Promise<ClaimResult>;
  markApplied(id: string, result: WriteResult): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  markSuperseded(id: string): Promise<void>;
  /** Legacy soft-delete used by the reject path (consume without applying). */
  delete(id: string): Promise<void>;
  sweep(now?: Date): Promise<void>;
}

/**
 * File-backed store so validate and apply can happen in different processes
 * (CLI invocations, MCP server restarts).
 *
 * LIMITATION: the file store is single-writer. Its `claim` is best-effort (read-check-write) and
 * does NOT provide cross-process atomicity — it is for the local single-operator CLI / standalone
 * MCP server only. Hosted multi-process/multi-container deployments MUST use a store whose `claim`
 * is a true atomic compare-and-set (see PostgresPendingStore in the cloud app).
 */
export class PendingStore implements PendingOperationStore {
  constructor(private readonly dir: string = path.join(adportHome(), 'pending')) {}

  private file(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error(`Invalid pending operation id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  private async read(id: string): Promise<PendingOperation | undefined> {
    try {
      const op = JSON.parse(await fs.readFile(this.file(id), 'utf8')) as PendingOperation;
      op.state ??= 'pending';
      return op;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  private async write(op: PendingOperation): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(op.id), JSON.stringify(op, null, 2), { mode: 0o600 });
  }

  async put(op: PendingOperation): Promise<void> {
    await this.write({ ...op, state: op.state ?? 'pending' });
  }

  async get(id: string): Promise<PendingOperation | undefined> {
    return this.read(id);
  }

  async claim(id: string, approver: ApplyActor): Promise<ClaimResult> {
    const op = await this.read(id);
    if (!op) return { status: 'not_found' };
    if (Date.parse(op.expiresAt) < Date.now()) return { status: 'expired', pending: op };
    const state = op.state ?? 'pending';
    if (state === 'applied') return { status: 'already_applied', result: op.result };
    if (state === 'applying') return { status: 'in_progress' };
    if (state === 'superseded' || state === 'expired') return { status: 'superseded' };
    if (state === 'rejected') return { status: 'rejected' };
    if (state === 'failed') return { status: 'superseded' }; // a failed (indeterminate) apply is terminal; re-validate to retry
    // state is 'pending': claim it.
    const claimed: PendingOperation = { ...op, state: 'applying', approvedBy: approver };
    await this.write(claimed);
    return { status: 'claimed', pending: claimed };
  }

  async markApplied(id: string, result: WriteResult): Promise<void> {
    const op = await this.read(id);
    if (!op) return;
    await this.write({ ...op, state: 'applied', result });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    const op = await this.read(id);
    if (!op) return;
    await this.write({ ...op, state: 'failed', preview: { ...op.preview, summary: op.preview.summary } });
    void reason;
  }

  async markSuperseded(id: string): Promise<void> {
    const op = await this.read(id);
    if (!op) return;
    await this.write({ ...op, state: 'superseded' });
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true });
  }

  /** Remove expired entries. Called opportunistically; never throws on races. */
  async sweep(now = new Date()): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const op = JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf8')) as PendingOperation;
        if (Date.parse(op.expiresAt) < now.getTime() && (op.state ?? 'pending') === 'pending') {
          await fs.rm(path.join(this.dir, name), { force: true });
        }
      } catch {
        // Unreadable entry: leave it; get() will surface the problem explicitly.
      }
    }
  }
}
