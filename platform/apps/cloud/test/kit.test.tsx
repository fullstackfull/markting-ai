import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusChip, TrustBadge, ConfidenceBadge, RiskBadge, FreshnessBadge, DataTable, BlockedState, EntityLink } from '@/components/kit';

/**
 * Hardening Program 31/32 — the design-system kit renders its meaning as TEXT with a status tone, so
 * identity is never color-alone (CVD-safe, screen-reader legible), and the status vocabulary is not
 * overloaded.
 */
describe('design-system kit — status is a label, not a color', () => {
  it('every badge renders a readable label (not color-only)', () => {
    expect(renderToStaticMarkup(<TrustBadge tier="RECONCILED" locale="en" />)).toContain('Trust: RECONCILED');
    expect(renderToStaticMarkup(<ConfidenceBadge confidence="LOW" locale="en" />)).toContain('Confidence: LOW');
    expect(renderToStaticMarkup(<RiskBadge risk="HIGH" locale="en" />)).toContain('Risk: HIGH');
    expect(renderToStaticMarkup(<FreshnessBadge ageDays={5} locale="en" />)).toContain('5');
  });

  it('maps tone to a class but always keeps the text label', () => {
    const good = renderToStaticMarkup(<StatusChip tone="good" label="Approved" />);
    expect(good).toContain('status ok');
    expect(good).toContain('Approved');
    expect(renderToStaticMarkup(<RiskBadge risk="HIGH" locale="en" />)).toContain('status critical');
  });

  it('risk never uses a success color; higher risk is a stronger warning', () => {
    expect(renderToStaticMarkup(<RiskBadge risk="LOW" locale="en" />)).not.toContain('status ok');
    expect(renderToStaticMarkup(<RiskBadge risk="HIGH" locale="en" />)).toContain('status critical');
  });

  it('is bilingual (RTL Arabic labels)', () => {
    expect(renderToStaticMarkup(<TrustBadge tier="SYNTHETIC" locale="ar" />)).toContain('الموثوقية');
  });

  it('DataTable carries a caption for screen readers and scoped headers', () => {
    const html = renderToStaticMarkup(<DataTable caption="Spend by campaign" head={['Campaign', 'Spend']} rows={[['A', '100']]} />);
    expect(html).toContain('sr-only');
    expect(html).toContain('Spend by campaign');
    expect(html).toContain('scope="col"');
  });

  it('BlockedState is distinct from empty (data withheld, with a reason)', () => {
    const html = renderToStaticMarkup(<BlockedState title="Profit UNKNOWN" reason="COGS missing — never inferred" />);
    expect(html).toContain('role="note"');
    expect(html).toContain('COGS missing');
  });

  it('EntityLink is a non-prefetching internal link', () => {
    expect(renderToStaticMarkup(<EntityLink href="/dashboard/creative/x" label="Hero" />)).toContain('href="/dashboard/creative/x"');
  });
});
