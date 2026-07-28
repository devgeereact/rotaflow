import { useCallback, useState } from 'react';
import { env } from '@/lib/env';
import { reportError } from '@/lib/sentry';

export interface DispatchResult {
  ok: boolean;
}

export interface UseInngestDispatch {
  sending: boolean;
  send: (name: string, data: Record<string, unknown>) => Promise<DispatchResult>;
}

/**
 * Dispatch a typed event to Inngest's ingest API using the write-only event key.
 * Fire-and-forget: failures are reported to Sentry, never thrown into the UI,
 * so a background dispatch can't break the user's flow.
 */
export function useInngestDispatch(): UseInngestDispatch {
  const [sending, setSending] = useState(false);

  const send = useCallback(
    async (name: string, data: Record<string, unknown>): Promise<DispatchResult> => {
      if (!env.inngestEventKey) {
        reportError(new Error('Inngest event key not configured'), { name });
        return { ok: false };
      }

      setSending(true);
      try {
        const res = await fetch(`https://inn.gs/e/${env.inngestEventKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, data }),
        });
        if (!res.ok) throw new Error(`Inngest dispatch failed: ${res.status}`);
        return { ok: true };
      } catch (error) {
        reportError(error, { event: name });
        return { ok: false };
      } finally {
        setSending(false);
      }
    },
    [],
  );

  return { sending, send };
}
