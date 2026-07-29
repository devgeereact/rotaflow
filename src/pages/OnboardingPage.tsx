import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, Building2, ShieldCheck, Users } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import {
  createOrganisation,
  mergeOrgSettings,
  updateOrganisation,
} from '@/services/orgService';
import { createLocation } from '@/services/locationService';
import { createInvite } from '@/services/inviteService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SplashScreen } from '@/components/SplashScreen';
import {
  OnboardingLayout,
  type OnboardingStepMeta,
} from '@/components/onboarding/OnboardingLayout';
import {
  StepCreateOrg,
  type CreateOrgValues,
} from '@/components/onboarding/StepCreateOrg';
import { StepAbout, type AboutValues } from '@/components/onboarding/StepAbout';
import {
  StepInviteTeam,
  type StagedInvite,
} from '@/components/onboarding/StepInviteTeam';
import { StepChoosePlan } from '@/components/onboarding/StepChoosePlan';
import { StepComplete } from '@/components/onboarding/StepComplete';
import {
  PLANS,
  type BillingPeriod,
  type PlanOption,
} from '@/components/onboarding/constants';

const BRAND_FEATURES = [
  {
    icon: Building2,
    title: 'Centralised scheduling',
    body: 'Manage all your locations, teams and shifts in one place.',
  },
  {
    icon: Users,
    title: 'Collaborate securely',
    body: 'Invite team members and assign roles with granular permissions.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliant & audit-ready',
    body: 'Tenant data is isolated at the database level, with audit logging.',
  },
  {
    icon: BarChart3,
    title: 'Insights that matter',
    body: 'Make data-driven decisions with reporting and analytics.',
  },
];

/**
 * Left-panel copy per step. A function rather than a lookup map so the return
 * type is definite — indexed access is `| undefined` under
 * `noUncheckedIndexedAccess`, and a non-null assertion here would be hiding
 * that rather than answering it.
 */
function stepCopy(step: number): { headline: JSX.Element; intro: string } {
  switch (step) {
    case 2:
      return {
        headline: (
          <>
            Tell us about your <span className="text-primary">organisation</span>
          </>
        ),
        intro: 'Help us tailor RotaFlow to your business needs and local settings.',
      };
    case 3:
      return {
        headline: (
          <>
            Build your team. <span className="text-primary">Get started together.</span>
          </>
        ),
        intro:
          'Invite your colleagues to join your organisation and start scheduling together.',
      };
    case 4:
      return {
        headline: (
          <>
            Choose the right plan for{' '}
            <span className="text-primary">your organisation</span>
          </>
        ),
        intro:
          'Select a plan that fits your current needs. You can change it at any time.',
      };
    case 5:
      return {
        headline: (
          <>
            You&rsquo;re all set!{' '}
            <span className="text-primary">Welcome to RotaFlow</span>
          </>
        ),
        intro: "Your organisation is ready to go. Here's what you can do next.",
      };
    default:
      return {
        headline: (
          <>
            Let&rsquo;s set up your <span className="text-primary">organisation</span>
          </>
        ),
        intro:
          'Create your organisation to start building shifts, teams and smarter schedules.',
      };
  }
}

/**
 * Five-step organisation onboarding (design/Organisation-Onboarding.png →
 * design/Onboarding-Complete.png), replacing the single-field create-only stub.
 *
 * The organisation is created at the end of step 1, not at the end of the
 * wizard: steps 2–4 need an org id to write against, and a user who abandons
 * midway still has a usable workspace rather than nothing. Every later step is
 * therefore an update, and every later step is skippable.
 */
export function OnboardingPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { loading, loadFailed, memberships, refresh, switchOrg } = useOrg();
  const { showError, showSuccess } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locationCount, setLocationCount] = useState(0);

  const [createValues, setCreateValues] = useState<CreateOrgValues>({
    name: '',
    slug: '',
    industry: '',
    size: '1-25',
  });
  const [aboutValues, setAboutValues] = useState<AboutValues>({
    industry: '',
    orgType: '',
    country: 'United Kingdom',
    timezone: 'Europe/London',
    workingWeek: 'mon-sun',
    locationName: '',
    locationAddress: '',
  });
  const [staged, setStaged] = useState<StagedInvite[]>([]);
  const [invitesCreated, setInvitesCreated] = useState(false);
  const [plan, setPlan] = useState<PlanOption['value']>('starter');
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

  // Someone who already belongs to an org has no business here — unless this
  // wizard is the thing that just created it.
  useEffect(() => {
    if (!loading && memberships.length > 0 && orgId === null) {
      navigate('/app/dashboard', { replace: true });
    }
  }, [loading, memberships, orgId, navigate]);

  const steps: OnboardingStepMeta[] = [
    {
      number: 1,
      title: 'Create organisation',
      subtitle: createValues.name.trim() || 'Set up your organisation',
    },
    {
      number: 2,
      title: 'About your organisation',
      subtitle:
        [aboutValues.industry, aboutValues.country].filter(Boolean).join(' · ') ||
        'Tell us more about your business',
    },
    {
      number: 3,
      title: 'Invite your team',
      subtitle: staged.length
        ? `${staged.length} invitation${staged.length === 1 ? '' : 's'}`
        : 'Add members to get started',
    },
    {
      number: 4,
      title: 'Choose a plan',
      subtitle: plan ? `${plan} · ${period}` : 'Select the right plan for you',
    },
    { number: 5, title: 'All done!', subtitle: "You're ready to go" },
  ];

  const handleCreateOrg = useCallback(async (): Promise<void> => {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const org = await createOrganisation(
        {
          name: createValues.name.trim(),
          slug: createValues.slug.trim(),
          settings: { industry: createValues.industry, size: createValues.size },
        },
        user.id,
      );
      setOrgId(org.id);
      await refresh();
      switchOrg(org.id);
      setAboutValues((v) => ({ ...v, industry: createValues.industry || v.industry }));
      setStep(2);
    } catch (err) {
      reportError(err, { area: 'onboarding:create-org' });
      const conflict = (err as { code?: string } | null)?.code === '23505';
      setError(
        conflict
          ? 'That organisation identifier is already taken. Try another.'
          : 'Could not create the organisation. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [user, createValues, refresh, switchOrg]);

  const handleAbout = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setSubmitting(true);
    setError(null);
    try {
      await mergeOrgSettings(orgId, {
        industry: aboutValues.industry,
        org_type: aboutValues.orgType,
        country: aboutValues.country,
        timezone: aboutValues.timezone,
        working_week: aboutValues.workingWeek,
      });

      if (aboutValues.locationName.trim()) {
        await createLocation({
          org_id: orgId,
          name: aboutValues.locationName.trim(),
          address: aboutValues.locationAddress.trim() || null,
          timezone: aboutValues.timezone,
        });
        setLocationCount((c) => c + 1);
      }
      setStep(3);
    } catch (err) {
      reportError(err, { area: 'onboarding:about' });
      setError('Could not save those details. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [orgId, aboutValues]);

  const handleCreateInvites = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setSubmitting(true);
    try {
      const results = await Promise.all(
        staged.map(async (invite): Promise<StagedInvite> => {
          try {
            const created = await createInvite(orgId, invite.email, invite.role);
            return { ...invite, url: created.acceptUrl };
          } catch (err) {
            reportError(err, { area: 'onboarding:invite' });
            return {
              ...invite,
              error: err instanceof Error ? err.message : 'Could not create',
            };
          }
        }),
      );
      setStaged(results);
      setInvitesCreated(true);

      const failed = results.filter((r) => r.error).length;
      if (failed > 0) {
        showError(`${failed} invitation${failed === 1 ? '' : 's'} could not be created.`);
      } else {
        showSuccess('Invitations created — copy each link to send it.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [orgId, staged, showError, showSuccess]);

  const handlePlan = useCallback(async (): Promise<void> => {
    if (!orgId || plan === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateOrganisation(orgId, { plan });
      await mergeOrgSettings(orgId, { billing_period: period });
      await refresh();
      setStep(5);
    } catch (err) {
      reportError(err, { area: 'onboarding:plan' });
      setError('Could not save your plan. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [orgId, plan, period, refresh]);

  const copyLink = useCallback(
    async (url: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(url);
        showSuccess('Invitation link copied.');
      } catch (err) {
        reportError(err, { area: 'onboarding:copy-link' });
        showError('Could not copy — select the link and copy it manually.');
      }
    },
    [showError, showSuccess],
  );

  const finish = useCallback((): void => {
    navigate('/app/dashboard', { replace: true });
  }, [navigate]);

  if (loading) return <SplashScreen />;

  // Same guard as AppShell: a failed load must never be read as "no org", or an
  // existing owner is invited to create a duplicate.
  if (loadFailed && memberships.length === 0) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <Card className="w-full max-w-sm text-center">
          <h1 className="mb-1 font-display text-2xl text-content dark:text-content-dark">
            Couldn&rsquo;t load your organisations
          </h1>
          <p className="mb-6 text-sm text-content-muted dark:text-content-muted-dark">
            If you already belong to one, creating another here would duplicate it. Check
            your connection and try again.
          </p>
          <Button className="w-full" onClick={() => void refresh()}>
            Retry
          </Button>
        </Card>
      </main>
    );
  }

  const { headline, intro } = stepCopy(step);

  return (
    <OnboardingLayout
      headline={headline}
      intro={intro}
      features={BRAND_FEATURES}
      steps={steps}
      currentStep={step}
      action={
        step === 1 ? (
          <Link
            to="/login"
            className="flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Back to sign in
          </Link>
        ) : null
      }
    >
      {step === 1 && (
        <StepCreateOrg
          values={createValues}
          onChange={(patch) => setCreateValues((v) => ({ ...v, ...patch }))}
          onContinue={() => void handleCreateOrg()}
          onCancel={() => navigate('/login')}
          submitting={submitting}
          error={error}
        />
      )}

      {step === 2 && (
        <StepAbout
          values={aboutValues}
          onChange={(patch) => setAboutValues((v) => ({ ...v, ...patch }))}
          onBack={() => setStep(1)}
          onContinue={() => void handleAbout()}
          submitting={submitting}
          error={error}
        />
      )}

      {step === 3 && (
        <StepInviteTeam
          staged={staged}
          onStage={setStaged}
          onSend={() => void handleCreateInvites()}
          onSkip={() => setStep(4)}
          onBack={() => setStep(2)}
          onCopy={(url) => void copyLink(url)}
          submitting={submitting}
          sent={invitesCreated}
        />
      )}

      {step === 4 && (
        <StepChoosePlan
          plan={plan}
          period={period}
          onSelect={setPlan}
          onPeriod={setPeriod}
          onBack={() => setStep(3)}
          onContinue={() => void handlePlan()}
          submitting={submitting}
          error={error}
        />
      )}

      {step === 5 && (
        <StepComplete
          orgName={createValues.name.trim() || 'Your organisation'}
          planLabel={PLANS.find((p) => p.value === plan)?.name ?? 'Starter'}
          locationCount={locationCount}
          inviteCount={staged.filter((s) => s.url).length}
          onFinish={finish}
        />
      )}
    </OnboardingLayout>
  );
}
