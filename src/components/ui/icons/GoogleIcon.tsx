/**
 * Google "G" mark for OAuth buttons (docs/design/signup.png, docs/design/signin.png).
 * Not a `lucide-react` icon: brand logos are fixed multi-colour marks, not
 * stylable iconography, so lucide (a single-colour outline set) has none.
 * Official four-colour path data. Colours are the brand's, not tokens.
 */
export function GoogleIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
        fill="#4285F4"
      />
      <path
        d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.09A12 12 0 0 0 12 24Z"
        fill="#34A853"
      />
      <path
        d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28V6.63H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.37l4.01-3.09Z"
        fill="#FBBC05"
      />
      <path
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.26 6.63l4.01 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
        fill="#EA4335"
      />
    </svg>
  );
}
