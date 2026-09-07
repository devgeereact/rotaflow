import { useCallback, useEffect, useState } from 'react';
import { Archive, Plus, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { JobTitleBadge } from '@/components/staff/JobTitleBadge';
import {
  JOB_TITLE_PALETTE,
  JOB_TITLE_PALETTE_SIZE,
  normaliseJobTitleName,
  nextFreeSwatch,
} from '@/lib/jobTitlePalette';
import {
  JobTitleConflictError,
  createJobTitle,
  listJobTitles,
  setJobTitleActive,
  updateJobTitle,
  usedColourIds,
} from '@/services/jobTitleService';
import { reportError } from '@/lib/sentry';
import type { JobTitle } from '@/types';

export interface JobTitlesSectionProps {
  orgId: string;
  /** False renders the catalogue read-only with the reason stated. */
  canManage: boolean;
  /**
   * Whether the viewer may change *who* manages the catalogue. Owner only:
   * `organisations_update` is owner-scoped in `0002`, so a manager offered
   * this control would watch every save fail on RLS.
   */
  canDelegate: boolean;
  /** Current value of `organisations.settings.job_titles_managed_by`. */
  managedBy: 'owner' | 'managers';
  onManagedByChange: (value: 'owner' | 'managers') => void;
  onChanged?: () => void;
}

/**
 * The organisation's job-title catalogue.
 *
 * ## Why it sits under Roles, and what the difference is
 *
 * The page it lives on already explains that a role *label* does not change
 * what somebody can do. A job title is one step further away from
 * authorisation: it describes the work. "Nurse", "Senior Carer" and
 * "Kitchen" say nothing about permissions, and the page says so in as many
 * words — because a tenant is perfectly free to create a title called "Owner",
 * and it must stay a description.
 *
 * ## The colour rules, and why they are refusals rather than warnings
 *
 * One colour per active title. The picker greys out a taken swatch and says
 * who has it; the database refuses the write regardless, so two managers
 * saving at the same moment cannot both take indigo. Archiving a title hands
 * its colour back.
 *
 * When the palette runs out the form says so and stops offering colours,
 * rather than reusing one. Two occupations sharing a swatch is worse than a
 * blocked form, because nothing on screen says the colour has stopped meaning
 * one thing.
 */
export function JobTitlesSection({
  orgId,
  canManage,
  canDelegate,
  managedBy,
  onManagedByChange,
  onChanged,
}: JobTitlesSectionProps): JSX.Element {
  const [titles, setTitles] = useState<JobTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState('');
  const [colour, setColour] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    try {
      const rows = await listJobTitles(orgId);
      setTitles(rows);
    } catch (err) {
      reportError(err, { area: 'settings:jobTitles' });
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const taken = usedColourIds(titles);
  const free = JOB_TITLE_PALETTE_SIZE - taken.length;
  const suggestion = nextFreeSwatch(taken);
  const chosen = colour ?? suggestion?.id ?? null;

  const duplicateName = titles.some(
    (title) => title.name_normalised === normaliseJobTitleName(name),
  );

  const holderOf = (colourId: string): JobTitle | undefined =>
    titles.find((title) => title.active && title.colour === colourId);

  const handleCreate = async (): Promise<void> => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      await createJobTitle({ org_id: orgId, name, colour: chosen });
      setName('');
      setColour(null);
      await load();
      onChanged?.();
    } catch (err) {
      if (err instanceof JobTitleConflictError) setError(err.message);
      else {
        reportError(err, { area: 'settings:jobTitles:create' });
        setError('Could not add that job title. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (title: JobTitle): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await updateJobTitle(title.id, { name: editName });
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      if (err instanceof JobTitleConflictError) setError(err.message);
      else {
        reportError(err, { area: 'settings:jobTitles:rename' });
        setError('Could not rename that job title.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRecolour = async (title: JobTitle, colourId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await updateJobTitle(title.id, { colour: colourId });
      await load();
      onChanged?.();
    } catch (err) {
      if (err instanceof JobTitleConflictError) setError(err.message);
      else {
        reportError(err, { area: 'settings:jobTitles:recolour' });
        setError('Could not change that colour.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleArchive = async (title: JobTitle): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await setJobTitleActive(title.id, !title.active);
      await load();
      onChanged?.();
    } catch (err) {
      if (err instanceof JobTitleConflictError) setError(err.message);
      else {
        reportError(err, { area: 'settings:jobTitles:archive' });
        setError('Could not change that job title.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Job titles"
      description="What people do, and the colour their work shows in on the rota. A job title describes the work; it grants nothing — what somebody may do is set by their role above."
    >
      {loading ? (
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      ) : failed ? (
        <div>
          <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
            The catalogue could not be read. This is not the same as having no job titles.
          </p>
          <Button onClick={() => void load()}>Retry</Button>
        </div>
      ) : (
        <>
          {titles.length === 0 ? (
            <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
              No job titles yet. Add the occupations people here are employed in —
              Registered Nurse, Senior Carer, Kitchen — and they become selectable on
              every staff record.
            </p>
          ) : (
            <ul className="mb-4 divide-y divide-surface-border dark:divide-surface-border-dark">
              {titles.map((title) => (
                <li key={title.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  {editing === title.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={`Rename ${title.name}`}
                        className="max-w-xs"
                      />
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void handleRename(title)}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <JobTitleBadge name={title.name} colour={title.colour} />
                      {!title.active && (
                        <span className="text-xs text-content-muted dark:text-content-muted-dark">
                          Archived — kept on the people who hold it, not offered for new
                          assignments
                        </span>
                      )}
                      {canManage && (
                        <div className="ml-auto flex flex-wrap items-center gap-1.5">
                          {title.active && (
                            <div
                              role="group"
                              aria-label={`Colour for ${title.name}`}
                              className="flex gap-1"
                            >
                              {JOB_TITLE_PALETTE.map((swatch) => {
                                const holder = holderOf(swatch.id);
                                const mine = title.colour === swatch.id;
                                const blocked = Boolean(holder) && !mine;
                                return (
                                  <button
                                    key={swatch.id}
                                    type="button"
                                    disabled={blocked || busy}
                                    aria-pressed={mine}
                                    title={
                                      blocked
                                        ? `${swatch.label} is used by ${holder?.name}`
                                        : swatch.label
                                    }
                                    onClick={() => void handleRecolour(title, swatch.id)}
                                    className={cn(
                                      'h-5 w-5 rounded-full ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                      swatch.accentClass,
                                      mine &&
                                        'ring-2 ring-content dark:ring-content-dark',
                                      blocked && 'opacity-25',
                                    )}
                                  >
                                    <span className="sr-only">
                                      {swatch.label}
                                      {blocked ? ` — used by ${holder?.name}` : ''}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(title.id);
                              setEditName(title.name);
                            }}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void handleArchive(title)}
                          >
                            {title.active ? (
                              <>
                                <Archive size={14} aria-hidden="true" className="mr-1" />
                                Archive
                              </>
                            ) : (
                              <>
                                <RotateCcw
                                  size={14}
                                  aria-hidden="true"
                                  className="mr-1"
                                />
                                Restore
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="border-t border-surface-border pt-4 dark:border-surface-border-dark">
              <Field
                label="Add a job title"
                error={
                  duplicateName && name.trim() !== ''
                    ? 'That title already exists. Names ignore capitals and extra spaces.'
                    : undefined
                }
                hint={
                  free === 0
                    ? `All ${JOB_TITLE_PALETTE_SIZE} colours are in use. A new title will be added without one and shown in a neutral badge — archive a title to free its colour.`
                    : `${free} of ${JOB_TITLE_PALETTE_SIZE} colours free.`
                }
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Registered Nurse"
                  className="max-w-xs"
                />
              </Field>

              {free > 0 && (
                <div
                  role="group"
                  aria-label="Colour for the new job title"
                  className="mt-3 flex flex-wrap gap-1.5"
                >
                  {JOB_TITLE_PALETTE.map((swatch) => {
                    const holder = holderOf(swatch.id);
                    return (
                      <button
                        key={swatch.id}
                        type="button"
                        disabled={Boolean(holder)}
                        aria-pressed={chosen === swatch.id}
                        title={
                          holder
                            ? `${swatch.label} is used by ${holder.name}`
                            : swatch.label
                        }
                        onClick={() => setColour(swatch.id)}
                        className={cn(
                          'h-6 w-6 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          swatch.accentClass,
                          chosen === swatch.id &&
                            'ring-2 ring-content dark:ring-content-dark',
                          holder && 'opacity-25',
                        )}
                      >
                        <span className="sr-only">
                          {swatch.label}
                          {holder ? ` — used by ${holder.name}` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {name.trim() !== '' && (
                <p className="mt-3 flex items-center gap-2 text-sm text-content-muted dark:text-content-muted-dark">
                  Preview
                  <JobTitleBadge name={name.trim()} colour={chosen} />
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-3 text-sm text-danger-ink dark:text-danger-ink-dark"
                >
                  {error}
                </p>
              )}

              <Button
                className="mt-3"
                disabled={busy || name.trim() === '' || duplicateName}
                onClick={() => void handleCreate()}
              >
                <Plus size={16} aria-hidden="true" className="mr-1.5" />
                Add job title
              </Button>
            </div>
          ) : (
            <p className="border-t border-surface-border pt-4 text-sm text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
              Only an owner can change the job-title catalogue in this organisation. An
              owner can hand this to managers below.
            </p>
          )}

          {canDelegate && (
            <div className="mt-4 border-t border-surface-border pt-4 dark:border-surface-border-dark">
              <div className="flex items-start gap-2.5 text-sm">
                <input
                  id="job-titles-managed-by"
                  type="checkbox"
                  checked={managedBy === 'managers'}
                  onChange={(e) =>
                    onManagedByChange(e.target.checked ? 'managers' : 'owner')
                  }
                  aria-describedby="job-titles-managed-by-hint"
                  className="mt-0.5 h-4 w-4 rounded border-surface-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
                />
                <span>
                  <label
                    htmlFor="job-titles-managed-by"
                    className="font-medium text-content dark:text-content-dark"
                  >
                    Let managers edit job titles
                  </label>
                  <span
                    id="job-titles-managed-by-hint"
                    className="block text-content-muted dark:text-content-muted-dark"
                  >
                    Off by default. This is enforced in the database, not just here — a
                    manager without it cannot add, rename, recolour or archive a title
                    however they reach the API.
                  </span>
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}
