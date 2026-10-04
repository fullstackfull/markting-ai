'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/components/i18n-provider';

/**
 * PHASE B (B11) — the Breakdown Explorer dimension selector. A client control that writes the chosen
 * dimension into the `dim` search param while PRESERVING `range` and every other param (same
 * URLSearchParams + router.push pattern as RangeControl), so the window and table state survive a switch.
 *
 * Only reachable dimensions are offered as active chips. Unreachable (NOT_SUPPORTED) dimensions are shown
 * too, but disabled — selecting one is impossible, so the surface never presents unsupported data; the
 * honest unavailable state is reached by URL only (e.g. a shared link), which the server page renders.
 */
export interface DimensionChoice {
  dimension: string;
  label: string;
  reachable: boolean;
  rawOnly: boolean;
}

export function DimensionControl({ choices, selected }: { choices: DimensionChoice[]; selected?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { locale } = useI18n();

  function go(dim: string) {
    const next = new URLSearchParams(params.toString());
    next.set('dim', dim);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="range-control" role="group" aria-label={locale === 'ar' ? 'بُعد التصنيف' : 'Breakdown dimension'}>
      {choices.map((c) => (
        <button
          key={c.dimension}
          type="button"
          className={`range-chip${c.dimension === selected ? ' active' : ''}`}
          aria-pressed={c.dimension === selected}
          disabled={!c.reachable}
          title={c.reachable ? undefined : locale === 'ar' ? 'غير متاح لهذا المزوّد' : 'Not available for this provider'}
          onClick={() => go(c.dimension)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
