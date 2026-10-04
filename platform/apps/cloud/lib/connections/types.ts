import type { ConnectionCapabilities } from './registry';
import type { AuthType, ConnectionCategory, ConnectionErrorClass, ConnectionHealthState, ConnectionStatus } from './vocabulary';

/**
 * CONNECTIONS CONTROL PLANE — the canonical connection shape shared by server read models and client UI.
 * Pure (no server-only) so client components can import it. Carries NO secret material.
 */
export interface CanonicalConnection {
  id: string | null;
  provider: string;
  label: string;
  category: ConnectionCategory;
  connectionType: string;
  status: ConnectionStatus;
  statusReason: string;
  health: ConnectionHealthState | null;
  authType: AuthType | null;
  environment: string;
  available: boolean;
  liveTransportImplemented: boolean;
  accountsTotal: number;
  accountsEnabled: number;
  accountSelectionId: string | null;
  scopesGranted: string[];
  scopesRequired: string[];
  missingScopes: string[];
  tokenExpiresAt: string | null;
  lastAuthenticatedAt: string | null;
  lastVerifiedAt: string | null;
  lastSyncAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  errorClass: ConnectionErrorClass | null;
  remediation: { action: string; detail: string } | null;
  reauthRequired: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  connectedAt: string | null;
  capabilities: ConnectionCapabilities;
}
