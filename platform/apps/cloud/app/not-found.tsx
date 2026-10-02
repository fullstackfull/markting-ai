import Link from 'next/link';
import { BrandLockup } from '@/components/logos';
import { AuthFrame } from '@/components/ui';
import { getT } from '@/lib/i18n/server';

export default async function NotFound() {
  const { t } = await getT();
  return (
    <AuthFrame label="404">
      <BrandLockup size="large" />
      <h1>{t('misc.notFoundTitle')}</h1>
      <p>{t('misc.notFoundCopy')}</p>
      <Link className="button full" href="/dashboard">{t('misc.returnOverview')}</Link>
    </AuthFrame>
  );
}
