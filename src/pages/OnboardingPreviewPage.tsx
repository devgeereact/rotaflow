import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Globe2,
  HelpCircle,
  MapPinned,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  BarChart3,
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
import { StepComplete } from '@/components/onboarding/StepComplete';

/**
 * Design-loop preview only — `/onboarding` needs a real Supabase session and
 * writes real rows (org creation, locations, invites). This renders steps 1,
 * 2 and 5 (the ones with reference designs) against local-only mock state, so
 * they can be screenshotted without auth or a database.
 *
 * `?step=1|2|5` picks the step; defaults to 1.
 */
export function OnboardingPreviewPage(): JSX.Element {
  const [params] = useSearchParams();
  const step = Number(params.get('step') ?? '1');

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
      action: (
        <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
          <ArrowLeft size={15} aria-hidden="true" />
          Back to sign in
        </span>
      ),
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
    },
    5: {
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
      action: (
        <span className="flex items-center gap-1.5 text-sm font-medium text-brand dark:text-brand-light">
          <HelpCircle size={15} aria-hidden="true" />
          Need help?
        </span>
      ),
    },
  }[step === 2 ? 2 : step === 5 ? 5 : 1];

  return (
    <OnboardingLayout
      headline={copy.headline}
      headlineAccent={copy.headlineAccent}
      intro={copy.intro}
      features={copy.features}
      steps={steps}
      currentStep={step}
      action={copy.action}
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
