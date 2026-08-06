/**
 * GitHub "octocat" mark for OAuth buttons. Replaces the reference design's
 * Microsoft icon, since this project's second OAuth provider is GitHub (see
 * `OAuthProvider` in `src/lib/env.ts`), not Microsoft/Azure.
 * Not a `lucide-react` icon: brand logos are fixed marks, not stylable
 * iconography. Renders in `currentColor` so it inherits the button's text
 * colour instead of a hardcoded black, unlike Google's fixed four-colour mark.
 */
export function GithubIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.5 0 12.29c0 5.42 3.44 10.02 8.21 11.65.6.11.82-.27.82-.6 0-.29-.01-1.26-.02-2.29-3.34.75-4.04-1.44-4.04-1.44-.55-1.43-1.33-1.82-1.33-1.82-1.09-.77.08-.75.08-.75 1.2.09 1.84 1.26 1.84 1.26 1.07 1.88 2.8 1.34 3.49 1.02.11-.79.42-1.34.76-1.65-2.66-.31-5.47-1.36-5.47-6.03 0-1.33.46-2.42 1.23-3.27-.12-.31-.53-1.56.12-3.25 0 0 1-.33 3.3 1.25a11.1 11.1 0 0 1 6 0c2.3-1.58 3.3-1.25 3.3-1.25.65 1.69.24 2.94.12 3.25.77.85 1.23 1.94 1.23 3.27 0 4.68-2.81 5.71-5.49 6.02.43.38.81 1.13.81 2.28 0 1.65-.02 2.98-.02 3.38 0 .33.22.72.83.6C20.57 22.3 24 17.7 24 12.29 24 5.5 18.63 0 12 0Z" />
    </svg>
  );
}
