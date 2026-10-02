'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { PlanLimitDetails } from '@/lib/cloud/plan-limit';
import { useI18n } from '@/components/i18n-provider';

export function PlanLimitModal({ limit, onClose }: { limit?: PlanLimitDetails; onClose: () => void }) {
  const { t } = useI18n();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!limit) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [limit, onClose]);
  if (!limit) return null;
  const planName = t(`support.plan_${limit.recommendedPlan}`);
  const points = [1, 2, 3].map((index) => t(`support.limit_${limit.kind}_point${index}`));
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="upgrade-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title" aria-describedby="upgrade-modal-copy">
        <button ref={closeButton} className="modal-close" type="button" onClick={onClose} aria-label={t('support.closeUpgrade')}>×</button>
        <span className="plan-kicker">{t(`support.limit_${limit.kind}_eyebrow`)}</span>
        <h2 id="upgrade-modal-title">{t(`support.limit_${limit.kind}_title`)}</h2>
        <p id="upgrade-modal-copy">{limit.message}</p>
        <div className="upgrade-plan-line"><span>{t('support.recommended')}</span><strong>{planName}</strong></div>
        <ul>{points.map((point) => <li key={point}>{point}</li>)}</ul>
        <div className="modal-actions">
          <Link className="button" href={`/dashboard/billing?intent=${limit.kind}`}>{t('support.seePlans')}</Link>
          <button className="button secondary" type="button" onClick={onClose}>{t('support.notNow')}</button>
        </div>
      </section>
    </div>
  );
}
