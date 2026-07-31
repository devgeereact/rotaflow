/**
 * Email validation, kept deliberately close to the SQL regex in
 * `0006_invites.sql` so the client and the database agree on what an address
 * is — with one addition: a TLD of at least two characters, which rules out
 * `a@b.c` typos the SQL pattern lets through.
 *
 * Why this exists at all: there is no `<form>` element anywhere in `src/`, so
 * every `type="email"` attribute in the app is decorative — native
 * constraint validation only runs on a real form submit, and every submit
 * path here is an `onClick` handler. Before this module, the only guard on
 * an address that triggers a Supabase Auth email was `.trim().length > 0`.
 * That produced enough hard bounces for Supabase to threaten restricting the
 * project's email sending (2026-07-31).
 */

/** Mirrors 0006_invites.sql's `create_invite` check, plus a 2+ char TLD. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

/**
 * Domains typo'd often enough to be worth catching. Keys are the whole
 * domain, never a suffix — matching on a suffix would "correct" the
 * perfectly real `yahoo.co.uk` into `yahoo.com`.
 */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.co': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outook.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icloud.con': 'icloud.com',
  'live.con': 'live.com',
  'btinternet.co': 'btinternet.com',
};

/**
 * A likely-intended correction for a well-formed but probably-mistyped
 * address, or null when nothing looks wrong.
 *
 * Deliberately advisory, never enforced: `gmial.com` is a syntactically
 * valid domain and could in principle be somebody's real mail server.
 * Callers should offer this as "did you mean…", not block on it — the cost
 * of wrongly blocking a real address is much higher than the cost of one
 * bounce.
 */
export function suggestEmailCorrection(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex === -1) return null;

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const corrected = DOMAIN_TYPOS[domain];
  return corrected ? `${local}@${corrected}` : null;
}
