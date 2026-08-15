import { supabase } from '@/lib/supabase';
import type { Tables } from '@/types/database.types';

export type Plan = Tables<'plans'>;

/**
 * The price list, in display order. RLS allows any signed-in user to read
 * it (0023) — an upgrade screen has to be able to say what the next plan
 * costs before the caller is confirmed as this org's owner.
 */
export async function listPlans(): Promise<Plan[]> {
  const { data, error } = await supabase.from('plans').select('*').order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/**
 * `supabase-js` populates `result.error` as a generic `FunctionsHttpError`
 * on any non-2xx response, leaving `result.data` null — so the specific
 * message the Edge Function returned (e.g. "Professional is not available
 * for checkout yet") never reaches the caller by default. The real body is
 * still readable off `.context`, which is the raw `Response`.
 */
async function extractFunctionErrorMessage(
  error: unknown,
  fallback: string,
): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      try {
        const body: unknown = await context.clone().json();
        if (body && typeof body === 'object' && 'error' in body) {
          const message = body.error;
          if (typeof message === 'string') {
            return message;
          }
        }
      } catch {
        // body wasn't JSON or didn't parse — fall through to fallback
      }
    }
  }
  return fallback;
}

/**
 * Starts a Stripe Checkout for the given plan and redirects the whole page
 * to it — there is no in-app checkout UI, Stripe hosts it entirely.
 */
export async function startCheckout(orgId: string, planCode: string): Promise<void> {
  const result = await supabase.functions.invoke<{ url: string; error?: string }>(
    'create-checkout-session',
    { body: { orgId, planCode } },
  );
  if (result.error) {
    throw new Error(
      await extractFunctionErrorMessage(result.error, 'Could not start checkout'),
    );
  }
  if (!result.data?.url) {
    throw new Error(result.data?.error || 'Could not start checkout');
  }
  window.location.href = result.data.url;
}

/**
 * Opens Stripe's hosted Customer Portal for invoices, payment method
 * updates and cancellation. Redirects the whole page, same as checkout.
 */
export async function openBillingPortal(orgId: string): Promise<void> {
  const result = await supabase.functions.invoke<{ url: string; error?: string }>(
    'create-portal-session',
    { body: { orgId } },
  );
  if (result.error) {
    throw new Error(
      await extractFunctionErrorMessage(
        result.error,
        'Could not open the billing portal',
      ),
    );
  }
  if (!result.data?.url) {
    throw new Error(result.data?.error || 'Could not open billing portal');
  }
  window.location.href = result.data.url;
}
