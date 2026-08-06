/**
 * Turns whatever `supabase.auth.*` threw into a sentence a person can act on.
 *
 * ## Why this is not just `err.message`
 *
 * supabase-js wraps **any** HTTP 5xx from GoTrue in an `AuthRetryableFetchError`
 * whose `message` is the literal string `"{}"`. The JSON body is never
 * extracted, so the real reason ("Error sending confirmation email") is thrown
 * away before the app ever sees it. The object still passes `instanceof Error`,
 * so the obvious `err instanceof Error ? err.message : …` renders `{}` on screen
 * and every auth page did exactly that.
 *
 * A user staring at `{}` cannot tell a wrong password from a mail-server outage,
 * and neither can anyone they report it to. So: use the message when it says
 * something, and otherwise say what the status code actually means.
 */

/** Messages carrying no information, whatever their source. */
function isUseless(message: string): boolean {
  const trimmed = message.trim();
  return (
    trimmed.length === 0 ||
    trimmed === '{}' ||
    trimmed === '[]' ||
    trimmed === 'null' ||
    trimmed === 'undefined' ||
    trimmed === '[object Object]'
  );
}

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

/**
 * @param fallback What to say when nothing better can be determined. Phrase it
 *   for the specific action, e.g. "Could not send the magic link."
 */
export function authErrorMessage(
  err: unknown,
  fallback = 'Something went wrong.',
): string {
  if (err instanceof Error && !isUseless(err.message)) return err.message;

  switch (statusOf(err)) {
    case 429:
      // GoTrue's own rate limit, and `smtp_max_frequency` (60s per address by
      // default on this project) surfaces here too.
      return 'Too many attempts. Wait a minute and try again.';
    case 500:
    case 502:
    case 503:
    case 504:
      // Overwhelmingly this is the mail step: GoTrue returns 500
      // "Error sending confirmation email" when SMTP rejects the recipient or
      // is unreachable, and that body is what supabase-js discards.
      return 'We could not send your email just now. The mail service rejected it or is unavailable. Check the address is right, then try again shortly.';
    case 0:
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return fallback;
  }
}
