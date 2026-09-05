import { createContext } from 'react';

/**
 * True for anything rendered inside `AppShell`'s scroll container.
 *
 * Only `PreviewCanvas` reads it — it is how a design-loop preview page knows
 * not to add the page padding the shell already supplies. Product screens have
 * no business knowing whether they are inside the shell, because they always
 * are.
 *
 * In its own module because a file that exports both a component and a
 * non-component breaks Fast Refresh (`react-refresh/only-export-components`),
 * and a stale preview after every save is exactly the friction the design loop
 * exists to remove.
 */
export const InAppShellContext = createContext(false);
