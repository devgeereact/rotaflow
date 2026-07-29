import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SplashScreen } from '@/components/SplashScreen';
import logo from '@/assets/logo.png';

/**
 * First-run screen for a user with no organisation membership. V1 is
 * create-only — there's no invites table yet, so "join an org" has no
 * backing mechanism (see plan risks). Don't fake that flow.
 */
export function OnboardingPage(): JSX.Element {
  const { loading, memberships, createOrg } = useOrg();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && memberships.length > 0) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [loading, memberships, navigate]);

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createOrg(name.trim());
      navigate('/app/dashboard');
    } catch (err) {
      reportError(err, { area: 'onboarding:create-org' });
      setError('Could not create the organisation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [name, createOrg, navigate]);

  if (loading) return <SplashScreen />;

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <Card className="w-full max-w-sm animate-fade-up text-center">
        <img src={logo} alt="RotaFlow" className="mx-auto mb-6 h-14 w-14" />
        <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
          Set up your organisation
        </h1>
        <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
          You'll be the owner and can invite managers and staff once your team is set
          up.
        </p>

        <input
          className="mb-4 w-full rounded-xl border border-surface-border bg-background px-3 py-2.5 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
          placeholder="Organisation name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          className="w-full"
          onClick={() => void handleCreate()}
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Creating…' : 'Create organisation'}
        </Button>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      </Card>
    </main>
  );
}
