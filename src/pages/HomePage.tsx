import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';

export function HomePage(): JSX.Element {
  const { user } = useSupabaseAuth();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <p className="mb-4 inline-block rounded-full border border-surface-border bg-surface px-3 py-1 text-sm text-content-muted dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark">
          Offline-first · Installable · Static
        </p>
        <h1 className="font-display text-5xl font-extrabold tracking-tight text-content md:text-7xl dark:text-content-dark">
          Ship a PWA <span className="text-primary">today</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-content-muted dark:text-content-muted-dark">
          A production-ready starter with auth, offline caching, image optimization, and
          monitoring — all on cheap static hosting.
        </p>

        {/* New CTA section for rota.gakinz.com demo */}
        <div className="mx-auto mt-8 w-full max-w-2xl rounded-lg border border-surface-border bg-surface p-6 text-left dark:border-surface-border-dark dark:bg-surface-dark">
          <div className="flex flex-col items-start gap-3">
            <span className="text-sm font-semibold text-content-muted dark:text-content-muted-dark">Live demo</span>
            <h2 className="text-2xl font-semibold text-content dark:text-content-dark">Try the public demo</h2>
            <p className="text-content-muted dark:text-content-muted-dark">
              A preview of the deployed PWA for quick inspection. The live site is hosted at
              rota.gakinz.com — open in a new tab to explore the demo environment.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a
                href="https://rota.gakinz.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:brightness-95"
              >
                Open rota.gakinz.com
              </a>
              <span className="text-sm text-content-muted dark:text-content-muted-dark">(Opens in a new tab)</span>
            </div>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-center gap-4">
          {user ? (
            <Link to="/app/dashboard">
              <Button size="lg">Go to dashboard</Button>
            </Link>
          ) : (
            <Link to="/login">
              <Button size="lg">Get started</Button>
            </Link>
          )}
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="text-content-muted underline-offset-4 hover:underline dark:text-content-muted-dark"
          >
            View docs
          </a>
        </div>
      </motion.div>
    </main>
  );
}
