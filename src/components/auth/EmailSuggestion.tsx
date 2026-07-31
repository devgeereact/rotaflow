import { suggestEmailCorrection } from '@/lib/email';

interface EmailSuggestionProps {
  email: string;
  /** Called with the corrected address when the user accepts the suggestion. */
  onAccept: (corrected: string) => void;
}

/**
 * "Did you mean …?" under an email field, for well-formed but
 * probably-mistyped domains (`gmial.com` → `gmail.com`).
 *
 * Advisory by design — it never blocks submission. A mistyped domain is
 * still a syntactically valid one, and wrongly blocking a real address is
 * worse than letting one bounce through. Renders nothing when the address
 * looks fine, which is the overwhelmingly common case.
 */
export function EmailSuggestion({
  email,
  onAccept,
}: EmailSuggestionProps): JSX.Element | null {
  const suggestion = suggestEmailCorrection(email);
  if (!suggestion) return null;

  return (
    <p className="mt-1.5 text-sm text-content-muted dark:text-content-muted-dark">
      Did you mean{' '}
      <button
        type="button"
        onClick={() => onAccept(suggestion)}
        className="font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {suggestion}
      </button>
      ?
    </p>
  );
}
