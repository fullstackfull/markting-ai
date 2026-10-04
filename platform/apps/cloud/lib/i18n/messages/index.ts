/**
 * Message catalogue. Each area module exports `{ en, ar }` with the same flat keys.
 * Add an area here when you create a new module. Keys are addressed as `area.key`.
 */
import { accounts } from './accounts';
import { adgroups } from './adgroups';
import { agents } from './agents';
import { approvals } from './approvals';
import { assistant } from './assistant';
import { audit } from './audit';
import { auth } from './auth';
import { billing } from './billing';
import { common } from './common';
import { connections } from './connections';
import { findings } from './findings';
import { misc } from './misc';
import { nav } from './nav';
import { onboarding } from './onboarding';
import { overview } from './overview';
import { policies } from './policies';
import { reports } from './reports';
import { support } from './support';
import { team } from './team';

const areas = { accounts, adgroups, agents, approvals, assistant, audit, auth, billing, common, connections, findings, misc, nav, onboarding, overview, policies, reports, support, team };

type Areas = typeof areas;
export type Messages = { [K in keyof Areas]: Areas[K]['en'] };

function pick<L extends 'en' | 'ar'>(locale: L): Messages {
  return Object.fromEntries(Object.entries(areas).map(([name, area]) => [name, (area as { en: object; ar: object })[locale]])) as Messages;
}

export const messages = { en: pick('en'), ar: pick('ar') } as const;
