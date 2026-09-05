import { Lock, ShieldCheck } from 'lucide-react';

const CLAIMS = [
  { icon: Lock, label: 'Encrypted in transit' },
  { icon: ShieldCheck, label: 'Tenant-isolated access' },
];

/**
 * The trust-badge row under the auth card (docs/design/signup.png,
 * docs/design/signin.png). The reference's third badge, "99.9% uptime", is
 * dropped, an SLA figure nobody has committed to is exactly the kind of
 * unverified claim HomePage.tsx already avoids for this pre-launch product.
 * The remaining labels name implemented controls rather than claiming legal
 * compliance or an undefined blanket of security.
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
