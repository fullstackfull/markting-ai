export type AdportErrorCode =
  | 'POLICY_VIOLATION'
  | 'PENDING_NOT_FOUND'
  | 'PENDING_EXPIRED'
  | 'PENDING_MISMATCH'
  | 'PENDING_SUPERSEDED'
  | 'PENDING_REJECTED'
  | 'APPLY_IN_PROGRESS'
  | 'REPREVIEW_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'GENERIC_WRITE_DISABLED'
  | 'WRITE_FORBIDDEN_READ_ONLY'
  | 'PROVIDER_ERROR'
  | 'INVALID_INPUT'
  | 'NOT_CONNECTED'
  | 'UNKNOWN_TOOL';

export class AdportError extends Error {
  constructor(
    public readonly code: AdportErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AdportError';
  }

  toJSON() {
    return { error: this.code, message: this.message, details: this.details };
  }
}
