import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { LanguagePill } from '@/components/ui/LanguagePill';
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
import { TeamIllustration } from '@/components/onboarding/TeamIllustration';
import type { BillingPeriod, PlanOption } from '@/components/onboarding/constants';

const PREVIEW_STEPS = [1, 2, 3, 4, 5] as const;
type PreviewStep = (typeof PREVIEW_STEPS)[number];

function isPreviewStep(value: number): value is PreviewStep {
  return (PREVIEW_STEPS as readonly number[]).includes(value);
}

/**
 * Design-loop preview only, `/onboarding` needs a real Supabase session and
 * writes real rows (org creation, locations, invites). This renders steps 1,
 * 2, 3 and 5 (the ones with reference designs) against local-only mock state,
 * so they can be screenshotted without auth or a database.
 *
 * `?step=1|2|3|5` picks the step; defaults to 1.
 */
export function OnboardingPreviewPage(): JSX.Element {
  const [params] = useSearchParams();
  const requested = Number(params.get('step') ?? '1');
  const step: PreviewStep = isPreviewStep(requested) ? requested : 1;

  const [createValues, setCreateValues] = useState<CreateOrgValues>({
    name: 'Sunnyvale Care Group',
    slug: 'sunnyvale-care',
    industry: 'Care home / residential care',
    size: '1-25',
  });
  const [aboutValues, setAboutValues] = useState<AboutValues>({
    industry: 'Care home / residential care',
    orgType: 'Private company',
    country: 'United Kingdom',
    timezone: 'Europe/London',
    workingWeek: 'mon-sun',
    locations: [
      {
        name: 'Sunnyvale Care Centre',
        address: '123 Care Street, Manchester, M1 1AA, United Kingdom',
      },
    ],
  });
  const [staged, setStaged] = useState<StagedInvite[]>([
    {
      email: 'james.davis@sunnyvalecare.co.uk',
      role: 'manager',
      department: 'Care',
      location: 'Main Branch',
    },
    {
      email: 'sarah.lower@sunnyvalecare.co.uk',
      role: 'staff',
      department: 'Nursing',
      location: 'Riverside House',
    },
    {
      email: 'michael.tan@sunnyvalecare.co.uk',
      role: 'staff',
      department: 'Support',
      location: 'Oakview Care Home',
    },
  ]);
  const [plan, setPlan] = useState<PlanOption['value']>('professional');
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

  const steps: OnboardingStepMeta[] = [
    {
      number: 1,
      title: 'Create organisation',
      subtitle: step >= 5 ? 'Sunnyvale Care Group' : 'Set up your organisation',
    },
    {
      number: 2,
      title: 'About your organisation',
      subtitle: step >= 5 ? 'Care Home · 1 location' : 'Tell us more about your business',
    },
    {
      number: 3,
      title: 'Invite your team',
      subtitle: step >= 5 ? '3 invites sent' : 'Add members to get started',
    },
    {
      number: 4,
      title: 'Choose a plan',
      subtitle: step >= 5 ? 'Professional · Monthly' : 'Select the right plan for you',
    },
    { number: 5, title: 'All done!', subtitle: "You're ready to go" },
  ];

  const copy = {
    1: {
      headline: 'Set up your',
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
      action: (
        <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to sign in
        </span>
      ),
      illustration: undefined,
    },
    2: {
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
      action: <LanguagePill />,
      illustration: undefined,
    },
    3: {
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
      action: (
        <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
          <ArrowLeft size={15} aria-hidden="true" />
          Back
        </span>
      ),
      illustration: <TeamIllustration />,
    },
    4: {
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
      action: (
        <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
          <ArrowLeft size={15} aria-hidden="true" />
          Back
        </span>
      ),
      illustration: undefined,
    },
    5: {
      headline: "You're all set!",
      headlineAccent: 'Welcome to RotaFlow',
      intro: 'Your organisation is ready. Three things worth doing first:',
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
      action: (
        <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
          <HelpCircle size={15} aria-hidden="true" />
          Need help?
        </span>
      ),
      illustration: undefined,
    },
  }[step];

  return (
    <OnboardingLayout
      headline={copy.headline}
      headlineAccent={copy.headlineAccent}
      intro={copy.intro}
      features={copy.features}
      steps={steps}
      currentStep={step}
      action={copy.action}
      illustration={copy.illustration}
    >
      {step === 1 && (
        <StepCreateOrg
          values={createValues}
          onChange={(patch) => setCreateValues((v) => ({ ...v, ...patch }))}
          onContinue={() => {}}
          onCancel={() => {}}
          submitting={false}
          error={null}
        />
      )}
      {step === 2 && (
        <StepAbout
          values={aboutValues}
          onChange={(patch) => setAboutValues((v) => ({ ...v, ...patch }))}
          onBack={() => {}}
          onContinue={() => {}}
          onSaveAndExit={() => {}}
          submitting={false}
          error={null}
        />
      )}
      {step === 3 && (
        <StepInviteTeam
          staged={staged}
          onStage={setStaged}
          onSend={() => {}}
          onSkip={() => {}}
          onCopy={() => {}}
          submitting={false}
          sent={false}
          locationNames={aboutValues.locations.map((l) => l.name).filter(Boolean)}
        />
      )}
      {step === 4 && (
        <StepChoosePlan
          plan={plan}
          period={period}
          onSelect={setPlan}
          onPeriod={setPeriod}
          onBack={() => {}}
          onContinue={() => {}}
          submitting={false}
          error={null}
        />
      )}
      {step === 5 && (
        <StepComplete
          orgName="Sunnyvale Care Group"
          planLabel="Professional"
          locationCount={3}
          inviteCount={3}
          onFinish={() => {}}
        />
      )}
    </OnboardingLayout>
  );
}
