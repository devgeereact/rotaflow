export interface PasswordRequirement {
  label: string;
  met: boolean;
}

/**
 * The password rules, evaluated against a candidate.
 *
 * These MIRROR what Supabase Auth will actually accept, and that is the whole
 * point of the list — a checklist that goes all-green and is then refused on
 * submit is worse than no checklist. It said "8+ characters" and required a
 * symbol; the server required 12 and no symbol (docs/SAAS.md GAP-031), so a
 * user could satisfy every tick on screen and still be rejected, with the
 * failure arriving from GoTrue in language this app did not write.
 *
 * The server's rule is `password_min_length = 12` with
 * `password_required_characters` demanding one lowercase, one uppercase and
 * one digit. Symbols are allowed and not required, so asking for one here
 * would be inventing a rule; twelve characters is the stronger protection
 * anyway, and it is the one actually enforced.
 *
 * If the project's auth config changes, this changes with it —
 * `scripts/check-auth-config.mjs` is what notices.
 */
export function evaluatePassword(password: string): PasswordRequirement[] {
  return [
    { label: '12+ characters', met: password.length >= 12 },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One number', met: /[0-9]/.test(password) },
  ];
}

/** The server's minimum, for the places that gate on length alone. */
export const PASSWORD_MIN_LENGTH = 12;
