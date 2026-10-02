import { redirect } from 'next/navigation';
import { BrandLockup } from '@/components/logos';
import { AuthFrame } from '@/components/ui';
import { getMcpOAuthClient } from '@/lib/cloud/mcp-oauth-repository';
import { sessionPrincipal } from '@/lib/cloud/auth';
import { db } from '@/lib/db';
import { validateAuthorizationRequest } from '@/lib/mcp-oauth';
import { createClient } from '@/lib/supabase/server';
import { getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuthorizePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { t } = await getT();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const item = first(value);
    if (item !== undefined) params.set(key, item);
  }
  const clientId = params.get('client_id') ?? '';
  const client = await getMcpOAuthClient(clientId);
  if (!client) return <AuthorizationError message={t('misc.clientNotRegistered')} />;
  let authorization;
  try {
    authorization = validateAuthorizationRequest(params, client);
  } catch (error) {
    return <AuthorizationError message={error instanceof Error ? error.message : t('misc.invalidRequest')} />;
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/login?return_to=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);
  const principal = await sessionPrincipal();
  const credentialScopes = principal.grantedScopes ?? principal.scopes;
  const grantedScopes = authorization.scopes.filter((scope) => credentialScopes.includes(scope));
  const organization = await db()<Array<{ name: string }>>`
    select name from public.organizations where id = ${principal.organizationId} limit 1
  `;
  const redirectHost = new URL(authorization.redirectUri).host;

  return (
    <AuthFrame label={t('misc.frameAuthorize')}>
      <BrandLockup size="large" />
      <h1>{t('misc.connectTitle', { client: authorization.clientName })}</h1>
      <p>
        {t('misc.grantBefore')} <strong>{authorization.clientName}</strong> {t('misc.grantMiddle')}
        {' '}<strong>{organization[0]?.name ?? t('misc.workspaceFallback')}</strong>. {t('misc.grantAfter')}
      </p>
      <div className="callout">
        {t('misc.returnDestination')} <strong>{redirectHost}</strong>. {t('misc.returnWarning')}
      </div>
      <dl className="connection-meta oauth-consent-scopes">
        {grantedScopes.includes('tools:read') ? <><dt>{t('misc.scopeRead')}</dt><dd>{t('misc.scopeReadCopy')}</dd></> : null}
        {grantedScopes.includes('tools:write') ? <><dt>{t('misc.scopeWrite')}</dt><dd>{t('misc.scopeWriteCopy')}</dd></> : null}
        {authorization.scopes.includes('tools:write') && principal.entitlement && !principal.entitlement.writeAccess
          ? <><dt>{t('misc.currentPlan')}</dt><dd>{t('misc.planBlocked')}</dd></>
          : null}
        {authorization.scopes.includes('tools:write') && principal.role === 'viewer'
          ? <><dt>{t('misc.currentRole')}</dt><dd>{t('misc.viewerBlocked')}</dd></>
          : null}
      </dl>
      <form className="form" method="post" action="/oauth/authorize/consent">
        {Array.from(params.entries()).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <div className="form-actions">
          <button className="button" type="submit" name="decision" value="allow">{t('misc.authorize')}</button>
          <button className="button secondary" type="submit" name="decision" value="deny">{t('misc.cancel')}</button>
        </div>
      </form>
      <p className="auth-switch">{t('misc.revokeNote')}</p>
    </AuthFrame>
  );
}

async function AuthorizationError({ message }: { message: string }) {
  const { t } = await getT();
  return (
    <AuthFrame label={t('misc.frameError')}>
      <BrandLockup size="large" />
      <h1>{t('misc.authErrorTitle')}</h1>
      <div className="error-callout" role="alert">{message}</div>
      <p>{t('misc.authErrorCopy')}</p>
    </AuthFrame>
  );
}
