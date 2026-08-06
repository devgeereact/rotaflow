import { ClockInView } from '@/components/clockin/ClockInView';
import {
  DEMO_ACTIVITY,
  DEMO_ATTENDANCE,
  DEMO_CLOCK_DATE,
  DEMO_CLOCK_TIME,
  DEMO_FOOTER,
  DEMO_HELP,
  DEMO_POLICY,
  DEMO_SCHEDULE,
  DEMO_SHIFT,
  DEMO_SUMMARY,
  DEMO_WEEK_LABEL,
  DEMO_WINDOW_LABEL,
} from '@/lib/clockinDemo';

/**
 * Design-loop preview only, `/app/clock` needs a real Supabase session, a
 * staff profile and a rostered shift. This renders the same `ClockInView` the
 * live route renders, against the fixed values in `@/lib/clockinDemo`, so the
 * screen can be screenshotted without auth or a database.
 *
 * The reference also shows the sidebar and top bar; those belong to AppShell,
 * and every design-loop preview in this repo renders page content only.
 */
/**
 * The live screen wires "Report an Issue" to its Troubleshooting dialog. The
 * preview only needs the button to exist so the footer matches the reference,
 * it renders only when a handler is supplied.
 */
function noop(): void {
  /* preview has nothing to report to */
}

export function ClockInPreviewPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-background px-6 py-8 dark:bg-background-dark md:px-10">
      <ClockInView
        policy={DEMO_POLICY}
        shift={DEMO_SHIFT}
        stage="ready"
        clockTime={DEMO_CLOCK_TIME}
        clockDateLabel={DEMO_CLOCK_DATE}
        windowLabel={DEMO_WINDOW_LABEL}
        schedule={DEMO_SCHEDULE}
        activity={DEMO_ACTIVITY}
        weekly={{
          periodLabel: DEMO_WEEK_LABEL,
          stats: DEMO_SUMMARY,
          completedPercent: 93,
          progressLabel: '93% of scheduled hours completed',
        }}
        attendance={DEMO_ATTENDANCE}
        help={DEMO_HELP}
        footer={{ ...DEMO_FOOTER, onReportIssue: noop }}
      />
    </div>
  );
}
