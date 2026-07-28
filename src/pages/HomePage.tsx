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
        <p className="mb-4 inline-block rounded-full border border-surface-border bg-surface px-3 py-1 text-sm text-content-muted">
          Offline-first · Installable · Static
        </p>
        <h1 className="font-display text-5xl font-extrabold tracking-tight text-content md:text-7xl">
          Ship a PWA <span className="text-primary">today</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-content-muted">
          A production-ready starter with auth, offline caching, image
          optimization, and monitoring — all on cheap static hosting.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          {user ? (
            <Link to="/dashboard">
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
            className="text-content-muted underline-offset-4 hover:underline"
          >
            View docs
          </a>
        </div>
      </motion.div>
    </main>
  );
}
