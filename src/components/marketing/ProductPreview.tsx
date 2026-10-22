import type { JSX } from 'react';
/**
 * The hero product shot, a manager's dashboard with a phone showing the same
 * week as a staff member sees it.
 *
 * Built from real markup and real design tokens rather than a screenshot, for
 * three reasons: a PNG of the app would be another megabyte in the precache
 * (`docs/SAAS.md` records a 1.2 MB logo that sat there through 45 PRs), an
 * exported screenshot goes stale the moment the UI moves, and markup respects
 * dark mode and the viewer's reduced-motion setting where an image cannot.
 *
 * It is illustrative, not a live render: the figures are the same ones the
 * dashboard mockup uses. Everything here is `aria-hidden`, a screen reader
 * gets the hero copy, which says the same thing in words, instead of a
 * meaningless tour of decorative cells.
 *
 * Motion, both halves of it optional: the shift chips fill the week in on the
 * CSS `pop-in` keyframe (visible with no JavaScript, dropped under reduced
 * motion), and `data-parallax` lets the marketing scroll motion drift the
 * phone over the dashboard as the hero scrolls away.
 */

/** When the rota chips start filling in: after the hero copy has landed. */
const CHIP_DELAY_START_MS = 300;
/** Between one chip and the next, reading left to right, row by row. */
const CHIP_DELAY_STEP_MS = 18;

const METRICS = [
  { label: 'On shift today', value: '41', tone: 'text-content dark:text-content-dark' },
  // The ink tokens, not `text-success` / `text-warning`: since the website took
  // the two-weight rule these figures are medium, not bold, so they need 4.5:1
  // rather than the large-text 3:1, and the plain status fills miss it
  // (`text-success` reads 3.33:1 on white).
  {
    label: 'Coverage',
    value: '92%',
    tone: 'text-success-ink dark:text-success-ink-dark',
  },
  {
    label: 'Open shifts',
    value: '23',
    tone: 'text-warning-ink dark:text-warning-ink-dark',
  },
];

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Shift chips per staff row, `null` is a day off, so the grid reads like a real week. */
const ROWS: { name: string; shifts: (keyof typeof CHIP | null)[] }[] = [
  { name: 'A. Okafor', shifts: ['early', 'early', null, 'late', 'late', null, null] },
  { name: 'J. Whitfield', shifts: ['day', 'day', 'day', null, null, 'night', 'night'] },
  { name: 'P. Nowak', shifts: [null, 'late', 'late', 'late', null, 'day', null] },
  { name: 'S. Bello', shifts: ['night', null, null, 'early', 'early', 'early', null] },
];

const CHIP = {
  early: 'bg-shift-tint-moss text-shift-tint-moss-fg',
  day: 'bg-shift-tint-sky text-shift-tint-sky-fg',
  late: 'bg-shift-tint-violet text-shift-tint-violet-fg',
  night: 'bg-shift-tint-indigo text-shift-tint-indigo-fg',
} as const;

/** Start time shown inside each hero rota chip. Matches `AGENDA` below. */
const CHIP_TIME = {
  early: '07:00',
  day: '09:00',
  late: '14:00',
  night: '22:00',
} as const;

const AGENDA = [
  { day: 'Mon 11', time: '07:00–15:00', role: 'Early · Floor 2', chip: CHIP.early },
  { day: 'Tue 12', time: '07:00–15:00', role: 'Early · Floor 2', chip: CHIP.early },
  { day: 'Thu 14', time: '14:00–22:00', role: 'Late · Floor 1', chip: CHIP.late },
  { day: 'Sat 16', time: '22:00–06:00', role: 'Night · Floor 1', chip: CHIP.night },
];

export function ProductPreview(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto max-w-5xl select-none px-6 xl:px-0"
    >
      {/*
        The phone is absolutely positioned over the dashboard's bottom-right
        corner, so on `lg` and up the dashboard reserves room for it. Without
        that reserve the phone sat on top of the last two columns of the rota
        grid and half the "Open shifts" metric, which reads as a layout bug
        rather than as depth.
      */}
      <div
        data-parallax="frame"
        className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lg lg:mr-40 xl:mr-48 dark:border-surface-border-dark dark:bg-surface-dark"
      >
        <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3 dark:border-surface-border-dark">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          <span className="ml-3 text-xs text-content-muted dark:text-content-muted-dark">
            Week of 11-17 May · Sunnyvale Care Home
          </span>
        </div>

        <div className="flex">
          {/*
            The mock sidebar steps aside from `xl`, where the shot shares the
            hero with the copy: in that narrower column it cost the rota grid
            its staff names.
          */}
          <div className="hidden w-40 shrink-0 border-r border-surface-border p-3 sm:block xl:hidden dark:border-surface-border-dark">
            <div className="mb-3 h-2 w-20 rounded bg-primary/25" />
            {['Dashboard', 'Rota', 'Schedule', 'Staff', 'Leave', 'Reports'].map(
              (item, i) => (
                <div
                  key={item}
                  className={`mb-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    i === 1
                      ? // Not the `bg-primary/10 text-primary dark:text-primary-ink-dark` tint every other
                        // icon-only badge on this page uses: with real text
                        // ("Rota") inside it reads at 4.08:1, under 4.5:1. A
                        // solid active-item fill reads as a legitimate nav
                        // convention on its own and passes easily.
                        'bg-primary text-primary-fg'
                      : 'text-content-muted dark:text-content-muted-dark'
                  }`}
                >
                  {item}
                </div>
              ),
            )}
          </div>

          <div className="min-w-0 flex-1 p-4">
            <div className="mb-4 grid grid-cols-3 gap-3">
              {METRICS.map(({ label, value, tone }) => (
                <div
                  key={label}
                  className="rounded-xl border border-surface-border p-3 dark:border-surface-border-dark"
                >
                  <p className="truncate text-[10px] uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
                    {label}
                  </p>
                  <p className={`font-display text-xl font-medium ${tone}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-surface-border dark:border-surface-border-dark">
              <div className="grid grid-cols-[minmax(5.5rem,1.4fr)_repeat(7,minmax(0,1fr))] border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                <span className="px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
                  Staff
                </span>
                {DAYS.map((day, i) => (
                  <span
                    key={`${day}-${i}`}
                    className="px-1 py-2 text-center text-[10px] font-medium text-content-muted dark:text-content-muted-dark"
                  >
                    {day}
                  </span>
                ))}
              </div>

              {ROWS.map(({ name, shifts }, row) => (
                <div
                  key={name}
                  className="grid grid-cols-[minmax(5.5rem,1.4fr)_repeat(7,minmax(0,1fr))] border-b border-divider last:border-0 dark:border-divider-dark"
                >
                  <span className="truncate px-3 py-2 text-xs text-content dark:text-content-dark">
                    {name}
                  </span>
                  {shifts.map((shift, i) => (
                    <span key={i} className="p-1">
                      <span
                        className={`flex h-7 items-center justify-center rounded ${shift ? `${CHIP[shift]} animate-pop-in motion-reduce:animate-none` : 'bg-divider dark:bg-divider-dark'}`}
                        style={
                          shift
                            ? {
                                animationDelay: `${CHIP_DELAY_START_MS + (row * DAYS.length + i) * CHIP_DELAY_STEP_MS}ms`,
                              }
                            : undefined
                        }
                      >
                        {shift && (
                          <span className="font-mono text-[8px] font-medium leading-none">
                            {CHIP_TIME[shift]}
                          </span>
                        )}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Staff phone. The same week, published */}
      <div
        data-parallax="phone"
        className="absolute -bottom-8 -right-2 hidden w-52 rounded-[1.75rem] border-4 border-content/85 bg-surface shadow-lg lg:block dark:border-content-dark/20 dark:bg-surface-dark"
      >
        <div className="rounded-t-[1.4rem] bg-primary px-4 pb-4 pt-5 text-primary-fg">
          {/* Not `opacity-80`: white at 80% over solid `bg-primary` reads at
              3.56:1, under the 4.5:1 small-text minimum. Full `text-primary-fg`
              (the token this fill is designed to pair with) passes easily. */}
          <p className="text-[10px] uppercase tracking-wide text-primary-fg">
            My schedule
          </p>
          <p className="font-display text-sm font-medium">11-17 May</p>
        </div>
        <div className="space-y-2 p-3">
          {AGENDA.map(({ day, time, role, chip }) => (
            <div
              key={day}
              className="rounded-lg border border-surface-border p-2 dark:border-surface-border-dark"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-content dark:text-content-dark">
                  {day}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${chip}`}>
                  {role.split(' · ')[0]}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-content-muted dark:text-content-muted-dark">
                {time}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
