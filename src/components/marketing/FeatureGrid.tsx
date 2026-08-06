import {
  CalendarDays,
  Download,
  MapPinned,
  Smartphone,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * Every entry here describes a capability that actually exists in the shipped
 * product, not the full PRD scope. RotaFlow's PRD lists ~14 Phase 1 feature
 * families (conflict detection, GPS clock-in, leave, swaps, timesheets,
 * reports…). Most are not built yet. A marketing page for a real product
 * should not advertise a feature list ahead of the build; do not add an entry
 * here without checking it against docs/SCREENS.md's `[Built]` column first.
 */
const FEATURES: Feature[] = [
  {
    icon: CalendarDays,
    title: 'Drag-and-drop rota builder',
    body: 'Build a week from a grid of your team and shift types, then publish when it is ready. Reuse shift types across every rota.',
  },
  {
    icon: Sparkles,
    title: 'AI-assisted auto-fill',
    body: 'Describe the shifts you need in plain language and get a first-pass rota to review and adjust, not blindly accept.',
  },
  {
    icon: MapPinned,
    title: 'Staff and locations in one place',
    body: 'A shared staff directory and multi-site locations, so scheduling across sites uses the same data everywhere.',
  },
  {
    icon: Download,
    title: 'One schedule everyone can see',
    body: 'Staff see day, week or month views of exactly what has been published, never a draft still being moved around, and can subscribe with any calendar app.',
  },
  {
    icon: UserPlus,
    title: 'Invite your team securely',
    body: 'Owners and managers invite people by email with a role attached. Each invitation is single-use and expires automatically.',
  },
  {
    icon: Smartphone,
    title: 'Installable on any device',
    body: 'RotaFlow installs like a native app on a phone or tablet, with no app store required.',
  },
];

export function FeatureGrid(): JSX.Element {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="font-display text-3xl font-bold text-content dark:text-content-dark md:text-4xl">
          Everything you need to build the rota
        </h2>
        <p className="mt-3 text-content-muted dark:text-content-muted-dark">
          RotaFlow is under active development. This is what is built and working today,
          not a promise of what is coming.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="h-full">
            <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon size={20} aria-hidden="true" />
            </span>
            <h3 className="mb-1.5 font-display text-lg font-semibold text-content dark:text-content-dark">
              {title}
            </h3>
            <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              {body}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
