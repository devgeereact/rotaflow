import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { GROUP_ORDER, searchEntries, type SearchEntry } from '@/lib/globalSearch';
import { cn } from '@/lib/utils';

/**
 * Global search. The `⌘K` palette in the app header.
 *
 * Searches screens and their actions rather than database records; see
 * `src/lib/globalSearch.ts` for why, and for what would change when record
 * search lands.
 *
 * ## Keyboard behaviour
 *
 * `⌘K` / `Ctrl+K` opens from anywhere, arrows move, Enter navigates, Escape
 * closes. The listbox is wired with `aria-activedescendant` rather than moving
 * DOM focus onto each option, so the input keeps focus and typing continues to
 * filter while the selection moves. The pattern every command palette uses and
 * the one screen readers announce correctly.
 */
interface GlobalSearchProps {
  /**
   * `rail` is the full-width, subdued row in the sidebar (see
   * `docs/ORGANISATION_WORKSPACE.html`'s `.kbar`). Omitted/`compact` is the
   * original pill, kept for any surface that still wants a narrow trigger.
   */
  variant?: 'compact' | 'rail';
  /** Fired after a result is chosen. The mobile drawer uses this to close itself. */
  onNavigate?: () => void;
}

export function GlobalSearch({
  variant = 'compact',
  onNavigate,
}: GlobalSearchProps): JSX.Element {
  const navigate = useNavigate();
  const { role } = useOrg();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => searchEntries(query, role), [query, role]);

  const grouped = useMemo(() => {
    const byGroup = new Map<string, SearchEntry[]>();
    for (const entry of results) {
      const list = byGroup.get(entry.group);
      if (list) list.push(entry);
      else byGroup.set(entry.group, [entry]);
    }
    // Flatten in group order so the rendered order and the index the arrow
    // keys walk are the same list. Keeping them separate is how a palette ends
    // up highlighting one row and opening another.
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      entries: byGroup.get(g) ?? [],
    }));
  }, [results]);

  const flat = useMemo(() => grouped.flatMap((section) => section.entries), [grouped]);

  const close = useCallback((): void => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const go = useCallback(
    (entry: SearchEntry | undefined): void => {
      if (!entry) return;
      void navigate(entry.to);
      close();
      onNavigate?.();
    },
    [navigate, close, onNavigate],
  );

  // ⌘K / Ctrl+K from anywhere in the app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A filtered list can be shorter than the current index, which would leave
  // the highlight pointing past the end and Enter doing nothing.
  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) =>
        flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length,
      );
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      go(flat[activeIndex]);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'rail'
            ? 'flex h-9 w-full items-center gap-2 rounded-xl border border-surface-border bg-surface px-2.5 text-[13px] text-content-muted hover:border-primary hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark dark:hover:text-content-dark'
            : 'flex h-10 items-center gap-2 rounded-xl border border-surface-border bg-surface px-3 text-sm text-content-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-muted-dark dark:hover:bg-surface-subtle-dark'
        }
      >
        <Search
          size={variant === 'rail' ? 14 : 16}
          aria-hidden="true"
          className="shrink-0"
        />
        <span
          className={
            variant === 'rail' ? 'flex-1 truncate text-left' : 'hidden sm:inline'
          }
        >
          {variant === 'rail' ? 'Search screens and actions' : 'Search'}
        </span>
        <kbd
          className={
            variant === 'rail'
              ? 'shrink-0 rounded border border-surface-border bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] font-semibold dark:border-surface-border-dark dark:bg-surface-subtle-dark'
              : 'ml-2 hidden rounded border border-surface-border px-1.5 py-0.5 font-mono text-[10px] lg:inline dark:border-surface-border-dark'
          }
        >
          ⌘K
        </kbd>
        <span className="sr-only">Search RotaFlow (Command K)</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]">
          <button
            type="button"
            aria-label="Close search"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 cursor-default bg-black/40"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search RotaFlow"
            className="relative z-10 flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
          >
            <div className="flex items-center gap-3 border-b border-surface-border px-4 dark:border-surface-border-dark">
              <Search
                size={18}
                aria-hidden="true"
                className="shrink-0 text-content-muted"
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="global-search-results"
                aria-activedescendant={
                  flat[activeIndex] ? `search-option-${activeIndex}` : undefined
                }
                aria-autocomplete="list"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search screens and actions…"
                className="h-14 flex-1 bg-transparent text-content outline-none placeholder:text-content-muted dark:text-content-dark"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close search"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-content-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-surface-subtle-dark"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div
              ref={listRef}
              id="global-search-results"
              role="listbox"
              aria-label="Search results"
              className="flex-1 overflow-y-auto p-2"
            >
              {flat.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing matches &ldquo;{query}&rdquo;. Try a screen name, or a word like
                  &ldquo;holiday&rdquo;, &ldquo;overtime&rdquo; or &ldquo;password&rdquo;.
                </p>
              ) : (
                grouped.map(({ group, entries }) => (
                  <div key={group} className="mb-1 last:mb-0">
                    <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
                      {group}
                    </p>
                    {entries.map((entry) => {
                      const index = flat.indexOf(entry);
                      const isActive = index === activeIndex;
                      return (
                        <button
                          key={entry.to + entry.label}
                          id={`search-option-${index}`}
                          role="option"
                          aria-selected={isActive}
                          data-active={isActive}
                          type="button"
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => go(entry)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm',
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-content dark:text-content-dark',
                          )}
                        >
                          <entry.icon size={16} aria-hidden="true" className="shrink-0" />
                          <span className="flex-1 truncate">{entry.label}</span>
                          {isActive && (
                            <CornerDownLeft
                              size={14}
                              aria-hidden="true"
                              className="shrink-0 opacity-60"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <p className="border-t border-surface-border px-4 py-2.5 text-xs text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
              <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> to
              move · <kbd className="font-mono">↵</kbd> to open ·{' '}
              <kbd className="font-mono">esc</kbd> to close
            </p>
          </div>
        </div>
      )}
    </>
  );
}
