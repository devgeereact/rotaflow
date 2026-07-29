export interface PasswordRequirement {
  label: string;
  met: boolean;
}

/** The four password rules this app enforces, evaluated against a candidate password. */
export function evaluatePassword(password: string): PasswordRequirement[] {
  return [
    { label: '8+ characters', met: password.length >= 8 },
    { label: 'One number', met: /[0-9]/.test(password) },
    { label: 'One uppercase', met: /[A-Z]/.test(password) },
    { label: 'One symbol', met: /[^A-Za-z0-9]/.test(password) },
  ];
}
