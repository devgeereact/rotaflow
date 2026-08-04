import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CircleAlert,
  Info,
  Sparkles,
  UserPlus,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PanelTabs, type PanelTabItem } from '@/components/ui/PanelTabs';
import { computeShiftIsoRange, formatDayLabel } from '@/lib/rotaGrid';
import {
  computeRotaInsights,
  suggestCoverForShift,
  summariseInsights,
  type CoverCandidate,
  type RotaInsight,
} from '@/lib/rotaInsights';
import { findClashingShift, type ShiftLike } from '@/lib/shiftConflicts';
import {
  generateRotaSuggestions,
  type AiShiftSuggestion,
} from '@/services/aiRotaService';
import { createShifts } from '@/services/shiftService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listOrgAvailability } from '@/services/availabilityService';
import { listExpiringDocuments } from '@/services/documentService';
import { reportError } from '@/lib/sentry';
import type {
  Availability,
  LeaveRequest,
  Location,
  Shift,
  ShiftInsert,
  ShiftType,
  StaffDocument,
  StaffProfile,
} from '@/types';

type Tab = 'review' | 'fill' | 'ask';

interface RotaAssistantPanelProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
  /** The shifts currently on the grid — what the assistant reasons about. */
  shifts: Shift[];
  staff: StaffProfile[];
  shiftTypes: ShiftType[];
  locations: Location[];
  weekStart: string;
  weekEnd: string;
  timezone: string;
  /**
   * Where an AI draft would be written. Null until a single location is
   * chosen: a suggestion has to land in one location's rota, and picking one
   * on the manager's behalf would silently roster people at the wrong site.
   */
  applyTarget: { locationId: string; rotaId: string } | null;
  onPreview: (suggestions: AiShiftSuggestion[]) => void;
  onApplied: () => void;
  onAssign: (shiftId: string, staffProfileId: string) => Promise<void>;
  onSelectShift: (shiftId: string) => void;
}

const SEVERITY_STYLE: Record<
  RotaInsight['severity'],
  { icon: typeof AlertTriangle; className: string; label: string }
> = {
  critical: {
    icon: CircleAlert,
    className: 'border-danger/30 bg-danger/5 text-danger',
    label: 'Blocking',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-warning/30 bg-warning/5 text-warning',
    label: 'Worth a look',
  },
  info: {
    icon: Info,
    className: 'border-surface-border bg-surface-subtle text-content-muted',
    label: 'For information',
  },
};

/**
 * The rota assistant.
 *
 * Three tabs, in the order a manager actually works: see what is wrong
 * (Review), fill the holes (Fill gaps), then ask for something bespoke (Ask
 * AI). The first two are computed locally in `lib/rotaInsights` and always
 * work — offline, with no API key, and with no possibility of an invented
 * name or date. Only the third calls a language model, and it degrades to a
 * plain message when one is not configured, because a demo that dies on a
 * missing environment variable is worse than one that says so.
 */
export function RotaAssistantPanel({
  open,
  onClose,
  orgId,
  shifts,
  staff,
  shiftTypes,
  locations,
  weekStart,
  weekEnd,
  timezone,
  applyTarget,
  onPreview,
  onApplied,
  onAssign,
  onSelectShift,
}: RotaAssistantPanelProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('review');
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextFailed, setContextFailed] = useState(false);
  const [assigningShiftId, setAssigningShiftId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiShiftSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A single clock for the whole panel, taken when it opens: every rule and
  // every candidate ranking has to agree on "now", and a value re-read per
  // render would make two lines of the same list disagree.
  const [now, setNow] = useState(() => Date.now());

  const resetAsk = useCallback((): void => {
    setPrompt('');
    setSummary(null);
    setSuggestions([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    resetAsk();
  }, [open, resetAsk]);

  // Leave, availability and document expiry are not part of the builder's own
  // load, so the assistant fetches them itself — and only when it is opened,
  // so the grid's first paint is never waiting on them.
  useEffect(() => {
    if (!open || !orgId) return;
    let active = true;
    setContextLoading(true);
    setContextFailed(false);
    void (async () => {
      try {
        const horizon = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
        const [leaveRows, availabilityRows, documentRows] = await Promise.all([
          listOrgLeaveRequests(orgId),
          listOrgAvailability(orgId),
          listExpiringDocuments(orgId, horizon),
        ]);
        if (!active) return;
        setLeave(leaveRows);
        setAvailability(availabilityRows);
        setDocuments(documentRows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'rota:assistant-context' });
        setContextFailed(true);
      } finally {
        if (active) setContextLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open, orgId]);

  const insights = useMemo(
    () =>
      computeRotaInsights({
        shifts,
        staff,
        shiftTypes,
        locations,
        leave,
        availability,
        documents,
        timezone,
        now,
      }),
    [shifts, staff, shiftTypes, locations, leave, availability, documents, timezone, now],
  );

  const overview = useMemo(
    () => summariseInsights(insights, shifts, now),
    [insights, shifts, now],
  );

  const openShifts = useMemo(
    () =>
      shifts
        .filter(
          (s) =>
            !s.staff_profile_id &&
            s.status !== 'cancelled' &&
            new Date(s.ends_at).getTime() > now,
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [shifts, now],
  );

  const coverByShift = useMemo(() => {
    const map = new Map<string, CoverCandidate[]>();
    for (const shift of openShifts.slice(0, 12)) {
      map.set(
        shift.id,
        suggestCoverForShift({
          shift,
          shifts,
          staff,
          leave,
          availability,
          timezone,
        }).slice(0, 3),
      );
    }
    return map;
  }, [openShifts, shifts, staff, leave, availability, timezone]);

  const typeById = useMemo(() => new Map(shiftTypes.map((t) => [t.id, t])), [shiftTypes]);
  const locationById = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  const handleClose = (): void => {
    onPreview([]);
    onClose();
  };

  const handleAssign = async (shiftId: string, staffProfileId: string): Promise<void> => {
    setAssigningShiftId(shiftId);
    try {
      await onAssign(shiftId, staffProfileId);
    } finally {
      setAssigningShiftId(null);
    }
  };

  const handleGenerate = async (): Promise<void> => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generateRotaSuggestions({
        orgId,
        prompt: prompt.trim(),
        periodStart: weekStart,
        periodEnd: weekEnd,
      });
      setSummary(result.summary);
      setSuggestions(result.suggestions);
      onPreview(result.suggestions);
    } catch (err) {
      reportError(err, { area: 'rota:assistant-generate' });
      setError(
        'The AI drafting service is not available right now. Review and Fill gaps still work — they run on this device.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    if (suggestions.length === 0 || !applyTarget) return;
    setApplying(true);
    setError(null);
    try {
      // The model proposes; it does not get to double-book. Each suggestion is
      // checked against the real rota *and* against the ones accepted earlier
      // in this same batch, so a plausible-looking draft cannot roster one
      // person twice in a single apply.
      const accepted: ShiftInsert[] = [];
      const placed: ShiftLike[] = shifts.map((s) => s);
      let skipped = 0;

      for (const s of suggestions) {
        const { startsAt, endsAt } = computeShiftIsoRange(
          s.date,
          s.startTime,
          s.endTime,
          timezone,
        );
        if (
          findClashingShift(
            { staffProfileId: s.staffProfileId, startsAt, endsAt },
            placed,
          )
        ) {
          skipped += 1;
          continue;
        }
        accepted.push({
          org_id: orgId,
          rota_id: applyTarget.rotaId,
          location_id: applyTarget.locationId,
          staff_profile_id: s.staffProfileId,
          shift_type_id: s.shiftTypeId,
          starts_at: startsAt,
          ends_at: endsAt,
          status: 'assigned',
          notes: s.reasoning || null,
        });
        placed.push({
          id: `pending:${accepted.length}`,
          staff_profile_id: s.staffProfileId,
          starts_at: startsAt,
          ends_at: endsAt,
          status: 'assigned',
        });
      }

      if (accepted.length === 0) {
        setError(
          'Every suggestion clashed with a shift already on the rota. Nothing was added.',
        );
        return;
      }

      await createShifts(accepted);
      if (skipped > 0) {
        // Reuses the panel's status line: the apply succeeded, but a manager
        // needs to know it did not do everything the preview showed.
        setError(
          `${accepted.length} added. ${skipped} skipped — those people were already rostered at the same time.`,
        );
      }
      onPreview([]);
      onApplied();
      if (skipped === 0) handleClose();
    } catch (err) {
      reportError(err, { area: 'rota:assistant-apply' });
      setError('Could not save these shifts. Please try again.');
    } finally {
      setApplying(false);
    }
  };

  const tabs: PanelTabItem<Tab>[] = [
    {
      value: 'review',
      label: `Review${insights.length ? ` (${insights.length})` : ''}`,
    },
    {
      value: 'fill',
      label: `Fill gaps${openShifts.length ? ` (${openShifts.length})` : ''}`,
    },
    { value: 'ask', label: 'Ask AI' },
  ];

  return (
    <Modal open={open} onClose={handleClose} title="Rota assistant">
      <div className="space-y-4">
        {/* ---- Headline: the one sentence a manager needs ---- */}
        <div className="rounded-xl border border-surface-border bg-surface-subtle p-3 dark:border-surface-border-dark dark:bg-surface-subtle-dark">
          <p className="flex items-start gap-2 text-sm font-medium text-content dark:text-content-dark">
            <Sparkles
              size={15}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-primary"
            />
            {contextLoading ? 'Reading the rota…' : overview.headline}
          </p>
          {contextFailed && (
            <p className="mt-1.5 pl-[1.4rem] text-xs text-warning">
              Leave and availability could not be loaded, so clashes against them are not
              included below.
            </p>
          )}
        </div>

        <PanelTabs
          items={tabs}
          active={tab}
          onChange={setTab}
          label="Rota assistant sections"
          gapClass="gap-4"
        />

        {/* ================= Review ================= */}
        {tab === 'review' &&
          (insights.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Nothing flagged for the shifts on screen. Move to another week to check
              further ahead.
            </p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {insights.map((insight) => {
                const style = SEVERITY_STYLE[insight.severity];
                const Icon = style.icon;
                return (
                  <li key={insight.id}>
                    <button
                      type="button"
                      disabled={!insight.shiftId}
                      onClick={() => {
                        if (!insight.shiftId) return;
                        onSelectShift(insight.shiftId);
                        handleClose();
                      }}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left',
                        style.className,
                        insight.shiftId && 'hover:brightness-95',
                      )}
                    >
                      <p className="flex items-start gap-1.5 text-sm font-semibold">
                        <Icon size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {insight.title}
                      </p>
                      <p className="mt-0.5 pl-[1.35rem] text-xs text-content-muted dark:text-content-muted-dark">
                        {insight.detail}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}

        {/* ================= Fill gaps ================= */}
        {tab === 'fill' &&
          (openShifts.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Every upcoming shift on screen has someone assigned.
            </p>
          ) : (
            <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
              {openShifts.slice(0, 12).map((shift) => {
                const type = shift.shift_type_id
                  ? typeById.get(shift.shift_type_id)
                  : undefined;
                const location = shift.location_id
                  ? locationById.get(shift.location_id)
                  : undefined;
                const day = formatDayLabel(shift.starts_at.slice(0, 10));
                const candidates = coverByShift.get(shift.id) ?? [];
                return (
                  <div
                    key={shift.id}
                    className="rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
                  >
                    <p className="text-sm font-semibold text-content dark:text-content-dark">
                      {type?.name ?? 'Shift'} · {day.weekday} {day.day}
                    </p>
                    <p className="mb-2 text-xs text-content-muted dark:text-content-muted-dark">
                      {location?.name ?? 'Unnamed site'}
                    </p>

                    {candidates.length === 0 ? (
                      <p className="text-xs text-warning">
                        Nobody on the roster is free for this one — everyone is on leave,
                        already working, or has marked themselves unavailable.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {candidates.map((candidate) => (
                          <li
                            key={candidate.staffProfileId}
                            className="flex items-start justify-between gap-2 rounded-lg bg-surface-subtle px-2.5 py-2 dark:bg-surface-subtle-dark"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                                {candidate.name}
                                {candidate.jobTitle && (
                                  <span className="ml-1.5 text-xs font-normal text-content-muted dark:text-content-muted-dark">
                                    {candidate.jobTitle}
                                  </span>
                                )}
                              </p>
                              {candidate.reasons.length > 0 && (
                                <p className="text-xs text-success">
                                  {candidate.reasons.join(' · ')}
                                </p>
                              )}
                              {candidate.blockers.length > 0 && (
                                <p className="text-xs text-warning">
                                  {candidate.blockers.join(' · ')}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={assigningShiftId === shift.id}
                              onClick={() =>
                                void handleAssign(shift.id, candidate.staffProfileId)
                              }
                            >
                              <UserPlus size={13} aria-hidden="true" />
                              {assigningShiftId === shift.id ? 'Assigning…' : 'Assign'}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {openShifts.length > 12 && (
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  Showing the 12 soonest of {openShifts.length} unfilled shifts.
                </p>
              )}
            </div>
          ))}

        {/* ================= Ask AI ================= */}
        {tab === 'ask' && (
          <div className="space-y-3">
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              Describe what you need for this week. Suggestions preview on the grid —
              nothing is saved until you apply them.
            </p>

            <label htmlFor="assistant-prompt" className="sr-only">
              Describe your staffing needs
            </label>
            <textarea
              id="assistant-prompt"
              className="w-full rounded-xl border border-surface-border bg-background px-4 py-3 text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-background-dark dark:text-content-dark"
              rows={3}
              placeholder="e.g. Cover Saturday and Sunday nights with two people who can do lates."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            <Button
              onClick={() => void handleGenerate()}
              disabled={generating || !prompt.trim()}
            >
              <Wand2 size={16} aria-hidden="true" className="mr-1.5" />
              {generating ? 'Thinking…' : 'Generate suggestions'}
            </Button>

            {error && (
              <p className="text-sm text-warning" role="status">
                {error}
              </p>
            )}

            {summary && (
              <p className="rounded-xl border border-surface-border p-3 text-sm text-content dark:border-surface-border-dark dark:text-content-dark">
                {summary}
              </p>
            )}

            {suggestions.length > 0 && (
              <>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-content-muted dark:text-content-muted-dark">
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      {s.staffName} · {formatDayLabel(s.date).weekday}{' '}
                      {formatDayLabel(s.date).day} · {s.startTime}–{s.endTime}
                      {s.shiftTypeName ? ` · ${s.shiftTypeName}` : ''}
                    </li>
                  ))}
                </ul>
                {applyTarget ? (
                  <Button
                    className="w-full"
                    onClick={() => void handleApply()}
                    disabled={applying}
                  >
                    {applying
                      ? 'Applying…'
                      : `Apply ${suggestions.length} shift${suggestions.length === 1 ? '' : 's'}`}
                  </Button>
                ) : (
                  <p className="text-sm text-warning">
                    Select a single location in the filters above to apply these — a shift
                    has to be written into one site&rsquo;s rota.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
