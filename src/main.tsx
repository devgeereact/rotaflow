import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { initSentry } from '@/lib/sentry';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { App, preloadPrerenderedPage } from '@/App';
import { shouldHydrate } from '@/lib/prerender';
import '@/index.css';

// Wire up monitoring before anything renders.
initSentry();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

// Keep this tree identical to `src/entry-prerender.tsx`.
const tree = (
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// A public page served from `dist/prerendered/` arrives with its markup in
// place and the path it was rendered for on `data-prerendered`. Hydrate that
// rather than replace it, so nothing blinks or replays its entrance. Anything
// else (the app shell, a service-worker navigation, the 404 page answering
// for an unknown path) starts from an empty render.
//
// The page's own chunk is loaded first. A lazy route that suspends while
// hydrating gets thrown away and rendered again the moment a provider updates
// (the session check, the consent state), replacing the very markup this is
// here to keep. The prerendered page stays on screen while the chunk loads.
if (shouldHydrate(container.dataset['prerendered'], window.location.pathname)) {
  void preloadPrerenderedPage(window.location.pathname)
    .catch(() => undefined)
    .then(() => {
      hydrateRoot(container, tree);
    });
} else {
  createRoot(container).render(tree);
}
