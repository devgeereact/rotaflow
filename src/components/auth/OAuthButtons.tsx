import { cn } from '@/lib/utils';
import type { OAuthProvider } from '@/lib/env';
import { GoogleIcon } from '@/components/ui/icons/GoogleIcon';
import { GithubIcon } from '@/components/ui/icons/GithubIcon';

const PROVIDER_ICON: Record<
  OAuthProvider,
  (props: { className?: string }) => JSX.Element
> = {
  google: GoogleIcon,
  github: GithubIcon,
};

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};

interface OAuthButtonsProps {
  providers: readonly OAuthProvider[];
  busy: boolean;
  onSelect: (provider: OAuthProvider) => void;
}

/**
 * The Google/GitHub row on the auth screens (design/signup.png shows
 * Google + Microsoft; this project's second provider is GitHub — see
 * `OAuthProvider` in src/lib/env.ts — so GitHub replaces it here).
 *
 * Only renders providers `env.oauthProviders` actually has enabled upstream
 * in Supabase; a button for a disabled provider is a dead end for the user.
 */
export function OAuthButtons({
  providers,
  busy,
  onSelect,
}: OAuthButtonsProps): JSX.Element | null {
  if (providers.length === 0) return null;

  return (
    <div className={cn('grid gap-3', providers.length > 1 && 'grid-cols-2')}>
      {providers.map((provider) => {
        const Icon = PROVIDER_ICON[provider];
        return (
          <button
            key={provider}
            type="button"
            disabled={busy}
            onClick={() => onSelect(provider)}
            className="flex h-12 items-center justify-center gap-2.5 rounded-xl border border-surface-border bg-surface text-sm font-medium text-content transition-transform duration-150 ease-in-out active:scale-[0.98] hover:scale-[1.02] hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
          >
            <Icon className="h-5 w-5" />
            {PROVIDER_LABEL[provider]}
          </button>
        );
      })}
    </div>
  );
}
