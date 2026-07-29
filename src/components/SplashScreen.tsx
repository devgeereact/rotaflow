import { CalendarCheck, ShieldCheck, Users, CheckCircle2 } from 'lucide-react';
import logo from '@/assets/logo.png';

const features = [
  { icon: CalendarCheck, label: 'Smart Scheduling' },
  { icon: ShieldCheck, label: 'Conflict Detection' },
  { icon: Users, label: 'Right People' },
  { icon: CheckCircle2, label: 'Better Coverage' },
];

export function SplashScreen(): JSX.Element {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background dark:bg-background-dark">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/5" />
      <div className="pointer-events-none absolute top-0 right-0 h-full w-1/3 bg-gradient-to-bl from-primary/10 to-transparent [clip-path:polygon(100%_0,100%_100%,30%_100%)]" />

      <div
        className="pointer-events-none absolute top-[58%] left-10 grid -translate-y-1/2 grid-cols-6 gap-x-6 gap-y-7"
        aria-hidden="true"
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-surface-border dark:bg-surface-border-dark"
          />
        ))}
      </div>

      <svg
        className="pointer-events-none absolute bottom-0 left-0 w-full text-surface-border dark:text-surface-border-dark"
        height="140"
        viewBox="0 0 1600 140"
        fill="none"
        aria-hidden="true"
      >
        <g stroke="currentColor" strokeWidth="1.5">
          {/* Hospital */}
          <rect x="60" y="40" width="90" height="100" />
          <line x1="85" y1="55" x2="85" y2="140" />
          <line x1="110" y1="55" x2="110" y2="140" />
          <line x1="135" y1="55" x2="135" y2="140" />
          <line x1="105" y1="10" x2="105" y2="34" />
          <line x1="93" y1="22" x2="117" y2="22" />
          {/* Tree */}
          <circle cx="165" cy="100" r="14" />
          <line x1="165" y1="114" x2="165" y2="140" />
          <path d="M180 60 L230 20 L280 60 Z" />
          <rect x="180" y="60" width="100" height="80" />
          <rect x="320" y="70" width="70" height="70" />
          <rect x="420" y="30" width="60" height="110" />
          {/* Tree */}
          <circle cx="1050" cy="105" r="12" />
          <line x1="1050" y1="117" x2="1050" y2="140" />
          <rect x="1100" y="50" width="80" height="90" />
          <rect x="1200" y="20" width="60" height="120" />
          <path d="M1290 40 L1330 0 L1370 40 Z" />
          <rect x="1290" y="40" width="80" height="100" />
          {/* Tree */}
          <circle cx="1400" cy="108" r="10" />
          <line x1="1400" y1="118" x2="1400" y2="140" />
          <rect x="1420" y="60" width="90" height="80" />
        </g>
      </svg>

      <div className="relative flex flex-col items-center px-8 text-center">
        <img src={logo} alt="RotaFlow" className="mb-6 h-48 w-48" />

        <h1 className="font-display text-6xl font-bold text-content dark:text-content-dark">
          Rota<span className="text-primary">Flow</span>
        </h1>
        <p className="mt-3 text-base font-semibold tracking-widest text-content-muted dark:text-content-muted-dark">
          WORKFORCE SCHEDULING PLATFORM
        </p>

        <span className="my-6 h-0.5 w-10 rounded-full bg-primary" />

        <p className="text-lg text-content dark:text-content-dark">
          The right people. In the right place.
          <br />
          Every shift.
        </p>

        <div className="mt-8 w-96">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-border dark:bg-surface-border-dark">
            <div className="h-full w-[43%] rounded-full bg-primary" />
          </div>
          <p className="mt-3 text-xs font-semibold tracking-widest text-primary">
            LOADING ROTA DATA...
          </p>
        </div>
      </div>

      <ul className="absolute top-[58%] right-24 hidden -translate-y-1/2 flex-col gap-8 md:flex lg:right-32">
        {features.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-3">
            <Icon size={22} className="text-primary" aria-hidden="true" />
            <span className="text-sm font-medium text-content dark:text-content-dark">
              {label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
