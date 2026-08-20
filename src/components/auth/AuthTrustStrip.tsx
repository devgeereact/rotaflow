import { Lock, ShieldCheck } from 'lucide-react';

const CLAIMS = [
  { icon: Lock, label: 'Secure & encrypted' },
  { icon: ShieldCheck, label: 'GDPR compliant' },
];

/**
 * The trust-badge row under the auth card (docs/design/signup.png,
 * docs/design/signin.png). The reference's third badge, "99.9% uptime", is
 * dropped, an SLA figure nobody has committed to is exactly the kind of
 * unverified claim HomePage.tsx already avoids for this pre-launch product.
 * "Secure & encrypted" and "GDPR compliant" describe the actual architecture
 * (RLS-scoped multi-tenancy, EU-region infra) so they stay.
 */
export function AuthTrustStrip(): JSX.Element {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 pb-4 pt-3">
      {CLAIMS.map(({ icon: Icon, label }) => (
        <li
          key={label}
          className="flex items-center gap-2 text-sm text-content-muted dark:text-content-muted-dark"
        >
          <Icon size={16} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
