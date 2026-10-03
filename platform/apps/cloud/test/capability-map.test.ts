import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITY_MAP } from '@/lib/markting/orchestrator/capability-map';
import { INTELLIGENCE_INTENTS } from '@/lib/markting/orchestrator/context';

/**
 * CODE-RC Program 26 — the capability map is CI-enforced: every capability must resolve to a real route
 * file, a real section kind (or 'surface'), a real intent (when declared), and named tests that exist on
 * disk. This makes a backend-only regression (a capability with no reachable surface) impossible to ship.
 */
const APP = resolve(import.meta.dirname, '..', 'app');
const TEST = resolve(import.meta.dirname);
const VALID_SECTION_KINDS = new Set([
  'anomaly', 'breakdown', 'campaign', 'commerce', 'creative', 'creativeDetail', 'crossChannel',
  'dataQuality', 'experiments', 'forecast', 'memory', 'outcomes', 'pacing', 'period', 'portfolio',
  'response', 'scaling', 'scenario', 'trend', 'surface',
]);

describe('capability map — every capability is reachable and tested', () => {
  it('has no duplicate capability names', () => {
    const names = CAPABILITY_MAP.map((c) => c.capability);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CAPABILITY_MAP.map((c) => [c.capability, c] as const))('“%s” resolves to real routes/sections/intent/tests', (_name, entry) => {
    expect(entry.routes.length, 'at least one route').toBeGreaterThan(0);
    for (const route of entry.routes) {
      expect(existsSync(resolve(APP, route)), `route missing: app/${route}`).toBe(true);
    }
    expect(entry.sections.length, 'at least one section/surface').toBeGreaterThan(0);
    for (const kind of entry.sections) {
      expect(VALID_SECTION_KINDS.has(kind), `unknown section kind: ${kind}`).toBe(true);
    }
    if (entry.intent) {
      expect((INTELLIGENCE_INTENTS as readonly string[]).includes(entry.intent), `unknown intent: ${entry.intent}`).toBe(true);
    }
    expect(entry.tests.length, 'at least one named test').toBeGreaterThan(0);
    for (const test of entry.tests) {
      const inCloud = existsSync(resolve(TEST, test));
      const inPackages = existsSync(resolve(import.meta.dirname, '..', '..', '..', 'packages')) &&
        ['meta', 'google', 'tiktok', 'snapchat'].some((p) => existsSync(resolve(import.meta.dirname, '..', '..', '..', 'packages', p, 'test', test)));
      expect(inCloud || inPackages, `named test not found: ${test}`).toBe(true);
    }
  });

  it('covers the core daily-use capabilities (campaign, creative, commerce, assistant, agency)', () => {
    const names = CAPABILITY_MAP.map((c) => c.capability.toLowerCase()).join(' | ');
    for (const kw of ['campaign', 'creative', 'commerce', 'assistant', 'agency']) {
      expect(names, `missing capability for ${kw}`).toContain(kw);
    }
  });
});
