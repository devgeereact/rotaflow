/**
 * The hero product shot, a manager's dashboard with a phone showing the same
 * week as a staff member sees it.
 *
 * Built from real markup and real design tokens rather than a screenshot, for
 * three reasons: a PNG of the app would be another megabyte in the precache
 * (`docs/audit01.md` records a 1.2 MB logo that sat there through 45 PRs), an
 * exported screenshot goes stale the moment the UI moves, and markup respects
 * dark mode and the viewer's reduced-motion setting where an image cannot.
 *
 * It is illustrative, not a live render: the figures are the same ones the
 * dashboard mockup uses. Everything here is `aria-hidden`, a screen reader
 * gets the hero copy, which says the same thing in words, instead of a
 * meaningless tour of decorative cells.
 */

const METRICS = [
  { label: 'On shift today', value: '41', tone: 'text-content dark:text-content-dark' },
  { label: 'Coverage', value: '92%', tone: 'text-success' },
  { label: 'Open shifts', value: '23', tone: 'text-warning' },
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

const AGENDA = [
  { day: 'Mon 11', time: '07:00-15:00', role: 'Early · Floor 2', chip: CHIP.early },
  { day: 'Tue 12', time: '07:00-15:00', role: 'Early · Floor 2', chip: CHIP.early },
  { day: 'Thu 14', time: '14:00-22:00', role: 'Late · Floor 1', chip: CHIP.late },
  { day: 'Sat 16', time: '22:00-06:00', role: 'Night · Floor 1', chip: CHIP.night },
];

export function ProductPreview(): JSX.Element {
  return (
    <div aria-hidden="true" className="relative mx-auto max-w-5xl select-none px-6">
      {/*
        The phone is absolutely positioned over the dashboard's bottom-right
        corner, so on `lg` and up the dashboard reserves room for it. Without
        that reserve the phone sat on top of the last two columns of the rota
        grid and half the "Open shifts" metric, which reads as a layout bug
        rather than as depth.
      */}
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-lg lg:mr-40 dark:border-surface-border-dark dark:bg-surface-dark">
        <div className="flex items-center gap-2 border-b border-surface-border px-4 py-3 dark:border-surface-border-dark">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
          <span className="ml-3 text-xs text-content-muted dark:text-content-muted-dark">
            Week of 11-17 May · Sunnyvale Care Home
          </span>
        </div>

        <div className="flex">
          <div className="hidden w-40 shrink-0 border-r border-surface-border p-3 sm:block dark:border-surface-border-dark">
            <div className="mb-3 h-2 w-20 rounded bg-primary/25" />
            {['Dashboard', 'Rota', 'Schedule', 'Staff', 'Leave', 'Reports'].map(
              (item, i) => (
                <div
                  key={item}
                  className={`mb-1 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    i === 1
                      ? 'bg-primary/10 text-primary'
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
                  <p className={`font-display text-xl font-bold ${tone}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-surface-border dark:border-surface-border-dark">
              <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(7,minmax(0,1fr))] border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                <span className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-content-muted dark:text-content-muted-dark">
                  Staff
                </span>
                {DAYS.map((day, i) => (
                  <span
                    key={`${day}-${i}`}
                    className="px-1 py-2 text-center text-[10px] font-semibold text-content-muted dark:text-content-muted-dark"
                  >
                    {day}
                  </span>
                ))}
              </div>

              {ROWS.map(({ name, shifts }) => (
                <div
                  key={name}
                  className="grid grid-cols-[minmax(0,1.4fr)_repeat(7,minmax(0,1fr))] border-b border-divider last:border-0 dark:border-divider-dark"
                >
                  <span className="truncate px-3 py-2 text-xs text-content dark:text-content-dark">
                    {name}
                  </span>
                  {shifts.map((shift, i) => (
                    <span key={i} className="p-1">
                      <span
                        className={`block h-5 rounded ${shift ? CHIP[shift] : 'bg-divider dark:bg-divider-dark'}`}
                      />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Staff phone. The same week, published */}
      <div className="absolute -bottom-8 -right-2 hidden w-52 rounded-[1.75rem] border-4 border-content/85 bg-surface shadow-lg lg:block dark:border-content-dark/20 dark:bg-surface-dark">
        <div className="rounded-t-[1.4rem] bg-primary px-4 pb-4 pt-5 text-primary-fg">
          <p className="text-[10px] uppercase tracking-wide opacity-80">My schedule</p>
          <p className="font-display text-sm font-bold">11-17 May</p>
        </div>
        <div className="space-y-2 p-3">
          {AGENDA.map(({ day, time, role, chip }) => (
            <div
              key={day}
              className="rounded-lg border border-surface-border p-2 dark:border-surface-border-dark"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-content dark:text-content-dark">
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
