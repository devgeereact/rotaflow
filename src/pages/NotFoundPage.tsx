import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage(): JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-display text-7xl font-extrabold text-primary dark:text-primary-ink-dark">
          404
        </p>
        <p className="mt-2 mb-8 text-content-muted dark:text-content-muted-dark">
          This page doesn't exist.
        </p>
        <Link to="/">
          <Button>Back home</Button>
        </Link>
      </div>
    </main>
  );
}
