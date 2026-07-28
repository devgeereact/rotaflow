import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage(): JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="font-display text-7xl font-extrabold text-primary">404</p>
        <p className="mt-2 mb-8 text-content-muted">This page doesn't exist.</p>
        <Link to="/">
          <Button>Back home</Button>
        </Link>
      </div>
    </main>
  );
}
