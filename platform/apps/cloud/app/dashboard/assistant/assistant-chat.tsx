'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/components/i18n-provider';

interface BridgeView {
  outcome: 'pending' | 'unsupported' | 'rejected_by_policy';
  reason?: string;
  code?: string;
  preview?: { pending_operation_id: string; expires_at: string; preview: { summary: string; changes: string[]; coercions: string[] } };
  proposal?: { tool_name: string; target_ref: string; account_ref: string; risk: string; reason: string; after: Array<{ field: string; value: unknown; unit?: string | null }> } | null;
  translation?: { provider: string; accountId: string; tool: string; notes: string[] };
}

interface TurnResponse { threadId: string; text: string; bridge: BridgeView | null; demoMode: boolean }

type Message = { role: 'user' | 'assistant'; text: string; bridge?: BridgeView | null; error?: boolean };

const SUGGESTION_KEYS = ['assistant.suggestion1', 'assistant.suggestion2', 'assistant.suggestion3'];

export function AssistantChat({ organizationId, canWrite, demoMode }: { organizationId: string; canWrite: boolean; demoMode: boolean }) {
  const { t, locale } = useI18n();
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setDraft('');
    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    try {
      const response = await fetch('/api/assistant/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId, threadId, text: trimmed }),
      });
      const result = await response.json().catch(() => ({})) as Partial<TurnResponse> & { error?: string };
      if (!response.ok) {
        setMessages((current) => [...current, { role: 'assistant', text: result.error ?? t('assistant.couldNotAnswer'), error: true }]);
      } else {
        if (result.threadId) setThreadId(result.threadId);
        setMessages((current) => [...current, { role: 'assistant', text: result.text ?? '', bridge: result.bridge ?? null }]);
      }
    } catch {
      setMessages((current) => [...current, { role: 'assistant', text: t('common.networkError'), error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <section className="card assistant">
      <div className="assistant-thread" aria-live="polite">
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <p>{t('assistant.emptyPrompt')}</p>
            <div className="assistant-suggestions">
              {SUGGESTION_KEYS.map((key) => (
                <button key={key} type="button" className="button secondary small" onClick={() => void send(t(key))} disabled={busy}>{t(key)}</button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((message, index) => (
          <article key={index} className={`assistant-message ${message.role}${message.error ? ' error' : ''}`}>
            <div className="assistant-role">{message.role === 'user' ? t('assistant.you') : t('assistant.assistant')}</div>
            <pre className="assistant-text">{message.text}</pre>
            {message.bridge ? <BridgeCard bridge={message.bridge} canWrite={canWrite} /> : null}
          </article>
        ))}
        {busy ? <div className="assistant-message assistant"><div className="assistant-role">{t('assistant.assistant')}</div><div className="skeleton-line" style={{ width: '60%' }} /></div> : null}
      </div>
      <form className="assistant-composer" onSubmit={submit}>
        <textarea
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(draft); } }}
          placeholder={demoMode ? t('assistant.placeholderDemo') : t('assistant.placeholderLive')}
          rows={2}
          maxLength={8000}
          disabled={busy}
          aria-label={t('assistant.messageLabel')}
        />
        <button type="submit" className="button" disabled={busy || !draft.trim()}>{busy ? t('common.thinking') : t('common.send')}</button>
      </form>
      {threadId ? <div className="cell-sub assistant-thread-id">{t('assistant.thread', { id: threadId.split('__').pop() ?? '' })}</div> : null}
    </section>
  );
}

function BridgeCard({ bridge, canWrite }: { bridge: BridgeView; canWrite: boolean }) {
  const { t, locale } = useI18n();
  if (bridge.outcome === 'pending' && bridge.preview) {
    return (
      <div className="callout success assistant-bridge">
        <strong>{t('assistant.bridgePendingTitle')}</strong>
        <p>{bridge.preview.preview.summary}</p>
        <ul>{bridge.preview.preview.changes.map((change) => <li key={change}>{change}</li>)}</ul>
        {bridge.preview.preview.coercions.length ? <p className="text-muted">{t('assistant.coercions', { list: bridge.preview.preview.coercions.join('; ') })}</p> : null}
        <p className="cell-sub">{t('assistant.pendingMeta', { id: bridge.preview.pending_operation_id, expires: new Date(bridge.preview.expires_at).toLocaleString(locale === 'ar' ? 'ar-u-nu-latn' : 'en') })}</p>
        <Link className="button small" href="/dashboard/approvals">{canWrite ? t('assistant.reviewApprovals') : t('assistant.viewApprovals')}</Link>
      </div>
    );
  }
  if (bridge.outcome === 'rejected_by_policy') {
    return (
      <div className="error-callout assistant-bridge">
        <strong>{t('assistant.bridgeRefusedTitle', { code: bridge.code ?? '' })}</strong>
        <p>{bridge.reason}</p>
        <p className="cell-sub">{t('assistant.bridgeRefusedCopy')}</p>
      </div>
    );
  }
  return (
    <div className="error-callout assistant-bridge">
      <strong>{t('assistant.bridgeUnsupportedTitle')}</strong>
      <p>{bridge.reason}</p>
      <p className="cell-sub">{t('assistant.nothingChanged')}</p>
    </div>
  );
}
