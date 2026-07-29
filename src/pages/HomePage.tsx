import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { Button } from '@/components/ui/Button';
import { PublicNav } from '@/components/marketing/PublicNav';
import { FeatureGrid } from '@/components/marketing/FeatureGrid';
import { IndustryStrip } from '@/components/marketing/IndustryStrip';
import { PublicFooter } from '@/components/marketing/PublicFooter';

/**
 * `/` — the public marketing homepage.
 *
 * Replaces the pwa-forge scaffold placeholder ("Ship a PWA today", a link to
 * raw github.com). Copy here is deliberately conservative: RotaFlow is a real,
 * pre-launch product, and this is the first thing a prospective organisation
 * sees. No fabricated stats, testimonials, or customer logos — none exist
 * yet, and inventing them is worse than a page that undersells slightly.
 * FeatureGrid lists only shipped capability; see its own comment for the rule.
 */
export function HomePage(): JSX.Element {
  const { user } = useSupabaseAuth();

  return (
    <div className="min-h-screen bg-background dark:bg-background-dark">
      <PublicNav />

      <main>
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center md:pt-28">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <p className="mb-4 inline-block rounded-full border border-surface-border bg-surface px-3 py-1 text-sm text-content-muted dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark">
              Offline-first · Installable · Multi-tenant
            </p>
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-content sm:text-5xl md:text-6xl dark:text-content-dark">
              Build and share staff rotas
              <span className="text-primary"> in minutes</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-content-muted dark:text-content-muted-dark">
              RotaFlow replaces the spreadsheet, the WhatsApp group and the printed notice
              board with one place to build a rota, publish it, and let your team see
              exactly what they&rsquo;re working — on any device.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {user ? (
                <Link to="/app/dashboard">
                  <Button size="lg">
                    Go to dashboard
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                </Link>
              ) : (
                <Link to="/signup">
                  <Button size="lg">
                    Get started free
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                </Link>
              )}
              <Link
                to="/login"
                className="text-content-muted underline-offset-4 hover:underline dark:text-content-muted-dark"
              >
                Sign in
              </Link>
            </div>
          </motion.div>
        </section>

        <IndustryStrip />
        <FeatureGrid />

        <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
          <div className="rounded-3xl border border-surface-border bg-surface p-10 shadow-sm dark:border-surface-border-dark dark:bg-surface-dark md:p-14">
            <h2 className="font-display text-2xl font-bold text-content dark:text-content-dark md:text-3xl">
              Set up your organisation today
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-content-muted dark:text-content-muted-dark">
              Create an organisation, add your first location, and build your first rota —
              no credit card, no sales call.
            </p>
            <div className="mt-8 flex justify-center">
              <Link to={user ? '/app/dashboard' : '/signup'}>
                <Button size="lg">
                  {user ? 'Go to dashboard' : 'Create your organisation'}
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
