import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  CheckCircle2,
  Globe2,
  Headphones,
  HelpCircle,
  Mail,
  MapPinned,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
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
import { LanguagePill } from '@/components/ui/LanguagePill';
import { SplashScreen } from '@/components/SplashScreen';
import {
  OnboardingLayout,
  type BrandFeature,
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
import { TeamIllustration } from '@/components/onboarding/TeamIllustration';
import {
  PLANS,
  type BillingPeriod,
  type PlanOption,
} from '@/components/onboarding/constants';

interface StepCopy {
  headline: string;
  headlineAccent: string;
  intro: string;
  features: BrandFeature[];
}

/**
 * Left-panel copy + feature list per step (design/Organisation-Onboarding.png,
 * design/Organisation-about.png, design/Team-onboarding.png,
 * design/Onboarding-Complete.png each show a different headline and feature
 * set; step 4 has no reference image, so it falls through to the step-1 copy
 * rather than inventing new copy for an unseen design).
 */
function stepCopy(step: number): StepCopy {
  switch (step) {
    case 2:
      return {
        headline: 'Tell us about your',
        headlineAccent: 'organisation',
        intro: 'Help us tailor RotaFlow to your business needs and local settings.',
        features: [
          {
            icon: Building2,
            title: 'Built for your industry',
            body: 'Get tools and best practices that match your field.',
          },
          {
            icon: Globe2,
            title: 'Localised experience',
            body: 'Set your region, time zone and working preferences.',
          },
          {
            icon: Settings2,
            title: 'Tailored to you',
            body: "We'll customise features and workflows to fit your needs.",
          },
          {
            icon: ShieldCheck,
            title: 'Compliant by default',
            body: 'Stay aligned with local laws and regulations from day one.',
          },
        ],
      };
    case 3:
      return {
        headline: 'Build your team.',
        headlineAccent: 'Get started together.',
        intro:
          'Invite your colleagues to join your organisation and start scheduling smarter, together.',
        features: [
          {
            icon: UserPlus,
            title: 'Invite in seconds',
            body: 'Send invites by email and get your team on board fast.',
          },
          {
            icon: ShieldCheck,
            title: 'Role-based access',
            body: "Assign roles and permissions that fit everyone's responsibilities.",
          },
          {
            icon: Mail,
            title: 'Secure & private',
            body: 'Invites are secure and only accessible by the intended recipients.',
          },
          {
            icon: CheckCircle2,
            title: 'Easy to manage',
            body: 'You can add more members anytime from settings.',
          },
        ],
      };
    case 4:
      return {
        headline: 'Choose the right plan for',
        headlineAccent: 'your organisation',
        intro:
          'Select a plan that fits your current needs. You can change or upgrade at any time.',
        features: [
          {
            icon: Zap,
            title: 'Start quickly',
            body: 'Get your team up and running in minutes.',
          },
          {
            icon: Users,
            title: 'Scale with confidence',
            body: 'Upgrade as your team and needs grow.',
          },
          {
            icon: ShieldCheck,
            title: 'Secure & compliant',
            body: 'Built with enterprise-grade security and UK compliance.',
          },
          {
            icon: Headphones,
            title: 'Expert support',
            body: 'Our team is here to help you every step of the way.',
          },
        ],
      };
    case 5:
      return {
        headline: "You're all set!",
        headlineAccent: 'Welcome to RotaFlow',
        intro: "Your organisation is ready to go. Here's what you can do next.",
        features: [
          {
            icon: BarChart3,
            title: 'Build smarter rotas',
            body: 'Create and publish rotas that work for your team.',
          },
          {
            icon: Users,
            title: 'Keep your team in sync',
            body: 'Everyone stays informed and on the same page.',
          },
          {
            icon: ShieldCheck,
            title: 'Track time with confidence',
            body: 'Accurate time tracking and compliance you can trust.',
          },
          {
            icon: Sparkles,
            title: 'Make better decisions',
            body: 'Powerful reports and insights to drive your business forward.',
          },
        ],
      };
    default:
      return {
        headline: "Let's set up your",
        headlineAccent: 'organisation',
        intro:
          'Create your organisation to start building shifts, teams and smarter schedules.',
        features: [
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
            body: 'Stay compliant with built-in rules, approvals and audit logs.',
          },
          {
            icon: MapPinned,
            title: 'Insights that matter',
            body: 'Make data-driven decisions with powerful reporting and analytics.',
          },
        ],
      };
  }
}

/** Top-right slot per step — only steps with a reference image get one. */
function stepAction(step: number, onBackToStep2: () => void): JSX.Element | null {
  if (step === 1) {
    return (
      <Link
        to="/login"
        className="flex items-center gap-1.5 text-sm font-medium text-brand hover:underline dark:text-brand-light"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Back to sign in
      </Link>
    );
  }
  if (step === 2) return <LanguagePill />;
  if (step === 3) {
    return (
      <button
        type="button"
        onClick={onBackToStep2}
        className="flex items-center gap-1.5 text-sm font-medium text-brand hover:underline dark:text-brand-light"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Back
      </button>
    );
  }
  if (step === 5) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
        <HelpCircle size={15} aria-hidden="true" />
        Need help?
      </span>
    );
  }
  return null;
}

const EMPTY_LOCATION: AboutValues['locations'][number] = { name: '', address: '' };

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
    locations: [EMPTY_LOCATION],
  });
  const [staged, setStaged] = useState<StagedInvite[]>([]);
  const [invitesCreated, setInvitesCreated] = useState(false);
  const [plan, setPlan] = useState<PlanOption['value']>('professional');
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

  const handleAbout = useCallback(
    async (after: 'continue' | 'exit' = 'continue'): Promise<void> => {
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

        const namedLocations = aboutValues.locations.filter((l) => l.name.trim());
        for (const location of namedLocations) {
          await createLocation({
            org_id: orgId,
            name: location.name.trim(),
            address: location.address.trim() || null,
            timezone: aboutValues.timezone,
          });
        }
        setLocationCount((c) => c + namedLocations.length);
        if (after === 'exit') {
          navigate('/app/dashboard', { replace: true });
        } else {
          setStep(3);
        }
      } catch (err) {
        reportError(err, { area: 'onboarding:about' });
        setError('Could not save those details. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [orgId, aboutValues, navigate],
  );

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

  const { headline, headlineAccent, intro, features } = stepCopy(step);

  return (
    <OnboardingLayout
      headline={headline}
      headlineAccent={headlineAccent}
      intro={intro}
      features={features}
      steps={steps}
      currentStep={step}
      action={stepAction(step, () => setStep(2))}
      illustration={step === 3 ? <TeamIllustration /> : undefined}
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
          onContinue={() => void handleAbout('continue')}
          onSaveAndExit={() => void handleAbout('exit')}
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
          onCopy={(url) => void copyLink(url)}
          submitting={submitting}
          sent={invitesCreated}
          locationNames={aboutValues.locations.map((l) => l.name).filter(Boolean)}
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
