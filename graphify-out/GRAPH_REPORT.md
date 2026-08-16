# Graph Report - ./src  (2026-08-07)

## Corpus Check
- 497 files · ~291,738 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2807 nodes · 9079 edges · 93 communities (91 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Admin Overview Demo
- Marketing
- App
- Announcements
- Admin
- Staff
- Onboarding
- Schedule
- Availability
- Staff Directory Mapping
- Ui
- Auth
- App
- Rota Builder Preview Page
- Clock Rows
- Clockin
- Staff
- Admin
- Layout
- Rota
- Rota Insights
- App
- Org Preferences
- Timesheets
- Offline Outbox
- Layout
- Gdpr Requests
- Ui
- Locations
- Platform Health
- Locations
- Admin
- Swap Service
- Support Access
- Rota
- Incident Metrics
- Swaps
- Platform Overview
- Locations
- Leave Rows
- App
- Locations Directory Mapping
- Overtime Rows
- Leave
- Swaps
- Support Metrics
- Platform Org Service
- Index
- Reports
- Report Prefs
- Database.Types
- Reports
- Timesheets
- Hours
- Leave
- Shift Conflicts
- App Boot Screen
- Ui
- Leave
- Invite Service
- Ui
- Clockin Demo
- App
- Feature Flag Service
- Reports Service
- Layout
- Timesheet Service
- Ui
- Rota
- Navigation Targets.Test
- Tenant Health
- Layout
- Splash Screen
- Staff
- Leave Demo
- Swaps Demo
- Smtp Settings Service
- Support Case Service
- Global Search
- Published Schedule
- Toast Context
- Rota Service
- Ics
- Reports Demo
- Marketing
- Staff
- Use P W A Install
- Leave
- Theme Context
- Leave
- Imagekit
- Marketing
- Vite-Env.D

## God Nodes (most connected - your core abstractions)
1. `cn()` - 304 edges
2. `reportError()` - 137 edges
3. `Card()` - 120 edges
4. `useOrg()` - 91 edges
5. `Button` - 88 edges
6. `useToast()` - 77 edges
7. `Shift` - 56 edges
8. `useSupabaseAuth()` - 55 edges
9. `supabase` - 55 edges
10. `StaffProfile` - 52 edges

## Surprising Connections (you probably didn't know these)
- `Props` --references--> `DeadLetterRecord`  [EXTRACTED]
  components/FailedWritesNotice.tsx → lib/offlineOutbox.ts
- `MatrixCell()` --calls--> `cn()`  [EXTRACTED]
  components/availability/AvailabilityMatrix.tsx → lib/utils.ts
- `NavList()` --calls--> `cn()`  [EXTRACTED]
  components/layout/AdminShell.tsx → lib/utils.ts
- `ConsoleRole()` --calls--> `useOrg()`  [EXTRACTED]
  components/layout/AdminShell.tsx → hooks/useOrg.ts
- `ConsoleRail()` --calls--> `cn()`  [EXTRACTED]
  components/layout/AdminShell.tsx → lib/utils.ts

## Import Cycles
- None detected.

## Communities (93 total, 2 thin omitted)

### Community 0 - "Admin Overview Demo"
Cohesion: 0.01
Nodes (136): CHURN_SHAPE, DEMO_ACTIVE_SUBSCRIPTIONS, DEMO_ACTIVE_USERS_SHARE, DEMO_ACTIVE_USERS_TODAY, DEMO_ACTIVE_USERS_TREND, DEMO_ACTIVITY, DEMO_ANNOUNCEMENTS, DEMO_API (+128 more)

### Community 1 - "Marketing"
Cohesion: 0.04
Nodes (65): BenefitGrid(), BenefitGridProps, Feature, FEATURES, FinalCta(), FinalCtaProps, MarketingLayout(), MarketingLayoutProps (+57 more)

### Community 2 - "App"
Cohesion: 0.02
Nodes (80): AboutPage, AcceptInvitePage, ActivityPage, AdminAuditPage, AdminBillingPage, AdminFeatureFlagsPage, AdminGdprPage, AdminIncidentsPage (+72 more)

### Community 3 - "Announcements"
Cohesion: 0.06
Nodes (63): AnnouncementComposerModalProps, AnnouncementFilterBar(), AnnouncementFilterBarProps, AnnouncementFilterOption, AnnouncementFilterSelect, AnnouncementIcon(), AnnouncementIconProps, CATEGORIES (+55 more)

### Community 4 - "Admin"
Cohesion: 0.06
Nodes (59): MeterRow, MeterRows(), MeterRowsProps, PAD, Sparkline(), SparklineProps, TrendChart(), TrendChartProps (+51 more)

### Community 5 - "Staff"
Cohesion: 0.06
Nodes (56): DocumentList(), DocumentListProps, LABELS, TONES, DocumentsCard(), DocumentsCardProps, PersonalInformationCard(), PersonalInformationCardProps (+48 more)

### Community 6 - "Onboarding"
Cohesion: 0.07
Nodes (55): BuildingIllustration(), BillingPeriod, COUNTRIES, INDUSTRIES, ORG_SIZES, ORG_TYPES, PlanOption, PLANS (+47 more)

### Community 7 - "Schedule"
Cohesion: 0.05
Nodes (52): ProfileLayout(), WorkspaceHeader(), WorkspaceHeaderProps, NextAutoPublishCard(), NextAutoPublishCardProps, OpenRequestsCard(), OpenRequestsCardProps, ScheduleRequest (+44 more)

### Community 8 - "Availability"
Cohesion: 0.07
Nodes (43): AvailabilityDonut(), AvailabilityDonutProps, AvailabilityMatrix(), AvailabilityMatrixProps, MatrixCell(), AvailabilityPagination(), AvailabilityPaginationProps, pageItems() (+35 more)

### Community 9 - "Staff Directory Mapping"
Cohesion: 0.08
Nodes (52): LocationFormModalProps, RotaGroup, ScheduleGroup, StaffAction, StaffActionsModal(), StaffActionsModalProps, CONTRACT_TYPES, StaffFormModal() (+44 more)

### Community 10 - "Ui"
Cohesion: 0.08
Nodes (45): AdminEmpty(), AdminError(), AdminLoading(), AdminPage(), Badge(), BadgeProps, TONES, Panel() (+37 more)

### Community 11 - "Auth"
Cohesion: 0.08
Nodes (41): AuthFeature, AuthSplitLayout(), EmailSuggestion(), EmailSuggestionProps, OAuthButtons(), OAuthButtonsProps, PROVIDER_ICON, PROVIDER_LABEL (+33 more)

### Community 12 - "App"
Cohesion: 0.08
Nodes (34): App(), AnnouncementComposerModal(), draftPeriod(), ErrorBoundary, Props, State, SettingsSection(), SettingsSectionProps (+26 more)

### Community 13 - "Rota Builder Preview Page"
Cohesion: 0.07
Nodes (45): RailAction, RotaActionRail(), RotaActionRailProps, buildShiftMap(), computeDailyTotals(), computeShiftIsoRange(), DailyStatus, getMonday() (+37 more)

### Community 14 - "Clock Rows"
Cohesion: 0.09
Nodes (45): ClockInView(), GeolocationStatus, GeoResult, useGeolocation, ACTIVITY_LABEL, activityKind(), activityTimeLabel(), breakWindow() (+37 more)

### Community 15 - "Clockin"
Cohesion: 0.07
Nodes (38): AttendanceStatusCard(), AttendanceStatusCardProps, TONES, ClockActionPane(), ClockActionPaneProps, RING, StageCopy, STAGES (+30 more)

### Community 16 - "Staff"
Cohesion: 0.07
Nodes (37): AvailabilityMeter(), AvailabilityMeterProps, DOT, LINE, fitSkills(), SkillChipList(), SkillChipListProps, TONES (+29 more)

### Community 17 - "Admin"
Cohesion: 0.10
Nodes (36): useConsoleRefresh(), useRegisterConsoleRefresh(), Permissions, PLATFORM_BILLING_ROLES, PLATFORM_CONFIG_ROLES, PLATFORM_ROLE_ADMIN_ROLES, PLATFORM_ROLE_LABELS, PLATFORM_ROLE_SCOPES (+28 more)

### Community 18 - "Layout"
Cohesion: 0.09
Nodes (33): ConsoleFooter(), Header(), NotificationBell(), initialsFor(), SidebarFooter(), SidebarFooterProps, initialsFor(), UserMenu() (+25 more)

### Community 19 - "Rota"
Cohesion: 0.12
Nodes (36): AssignShiftModalProps, PreviewShiftChip(), PreviewShiftChipProps, RotaAssistantPanelProps, RotaGrid(), RotaGridProps, statusColour(), RotaGridCell() (+28 more)

### Community 20 - "Rota Insights"
Cohesion: 0.08
Nodes (39): RotaAssistantPanel(), SEVERITY_STYLE, Tab, computeRotaInsights(), CoverCandidate, CoverSuggestionInput, dayLabel(), describePeriodForPrompt() (+31 more)

### Community 21 - "App"
Cohesion: 0.12
Nodes (38): ScheduleGrouping, ScheduleViewBarProps, VIEWS, usePermissions(), RealtimeScope, RealtimeTable, useRealtimeRefresh, UseRealtimeRefreshOptions (+30 more)

### Community 22 - "Org Preferences"
Cohesion: 0.10
Nodes (37): Toggle(), ToggleProps, bool(), DEFAULT_POLICIES, DEFAULT_ROLE_LABELS, defaultNotificationMatrix(), Json, NOTIFICATION_CHANNELS (+29 more)

### Community 23 - "Timesheets"
Cohesion: 0.08
Nodes (31): PendingApprovalCard(), PendingApprovalCardProps, PendingTimesheet, QuickAction, QuickActionsCard(), QuickActionsCardProps, FilterOption, STATUSES (+23 more)

### Community 24 - "Offline Outbox"
Cohesion: 0.12
Nodes (33): QueuedItem, useSyncQueue, byQueuedAt(), deadLetterList(), DeadLetterRecord, deadLetterRemove(), openDb(), outboxAdd() (+25 more)

### Community 25 - "Layout"
Cohesion: 0.10
Nodes (26): AppShell(), MobileTabBar(), MobileTabBarProps, TabItem, TABS, OrgSwitcher(), OwnerOnlyNotice(), SettingsLayout() (+18 more)

### Community 26 - "Gdpr Requests"
Cohesion: 0.15
Nodes (33): addMonths(), CLOSED_STATUSES, closedWithin(), daysUntil(), deadlineState, effectiveDueDate(), extendedDueDate(), formatDeadline() (+25 more)

### Community 27 - "Ui"
Cohesion: 0.08
Nodes (24): StatCard(), StatCardProps, CoverageRing(), CoverageRingProps, PublishedScheduleChip(), isWeekend(), PublishedScheduleGrid(), StaffProfileHeader() (+16 more)

### Community 28 - "Locations"
Cohesion: 0.11
Nodes (27): DepartmentAction, DepartmentsView(), DepartmentsViewProps, LocationsTable(), LocationsTipBanner(), LocationsView(), SiteFilterBar(), SiteFilterBarProps (+19 more)

### Community 29 - "Platform Health"
Cohesion: 0.12
Nodes (28): formatLatency(), HealthCheck, HealthStatus, LATENCY_DEGRADED_MS, LATENCY_DOWN_MS, overallStatus(), SEVERITY, statusForLatency() (+20 more)

### Community 30 - "Locations"
Cohesion: 0.11
Nodes (26): DEPARTMENT_ICONS, DepartmentOverviewPanel(), DepartmentOverviewPanelProps, LocationDetailsPanel(), LocationDetailsPanelProps, TABS, ICONS, MARKS (+18 more)

### Community 31 - "Admin"
Cohesion: 0.06
Nodes (30): AdminPreviewHarness(), ANNOUNCEMENT_DELIVERIES, ANNOUNCEMENTS, AUDIT_LOGS, BACKGROUND_JOBS, CONNECTOR_STATS, FEATURE_FLAGS, fixtureFor() (+22 more)

### Community 32 - "Swap Service"
Cohesion: 0.13
Nodes (27): FailedWritesNotice(), KIND_LABELS, Props, DispatchResult, useInngestDispatch, CsvColumn, fullName(), requestedLabel() (+19 more)

### Community 33 - "Support Access"
Cohesion: 0.16
Nodes (25): SupportAccessBanner(), formatRemaining(), millisecondsRemaining(), MIN_REASON_LENGTH, SCOPE_LABELS, sessionStatus(), summariseSessions(), SUPPORT_ACCESS_DURATIONS (+17 more)

### Community 34 - "Rota"
Cohesion: 0.11
Nodes (23): SuspendOrgModal(), BLANK_FORM, FormState, ShiftTypeManagerModal(), ShiftTypeManagerModalProps, BLANK, DocumentsModal(), DocumentsModalProps (+15 more)

### Community 35 - "Incident Metrics"
Cohesion: 0.14
Nodes (23): criticalsSince(), formatDuration(), IncidentLike, meanTimeToDetect(), meanTimeToResolve(), minutesBetween(), monthOverMonth(), openIncidents() (+15 more)

### Community 36 - "Swaps"
Cohesion: 0.11
Nodes (24): ICONS, SwapActivityCard(), SwapActivityCardProps, SwapActivityEntry, SwapActivityKind, TINTS, SwapFilterBar(), SwapFilterBarProps (+16 more)

### Community 37 - "Platform Overview"
Cohesion: 0.12
Nodes (22): Callout(), CalloutProps, CalloutTone, TONES, NOTIFICATION_GAPS, NotificationRow, NotificationSummary, summariseNotifications() (+14 more)

### Community 38 - "Locations"
Cohesion: 0.12
Nodes (22): CoverageMeter(), FILLS, COLUMNS, DepartmentsTable(), DepartmentsTableProps, COLUMNS, LocationsTableProps, LocationsViewProps (+14 more)

### Community 39 - "Leave Rows"
Cohesion: 0.17
Nodes (21): sumApprovedLeaveDays(), countLeaveDaysByType(), formatLeaveDays(), formatLeaveDuration(), formatLeaveRange(), formatRequestedAt(), leaveDayCount(), parseDay() (+13 more)

### Community 40 - "App"
Cohesion: 0.10
Nodes (24): DashboardView(), DashboardViewProps, initials(), MonthlyOverview(), MonthlyOverviewProps, QUICK_ACTIONS, QuickAction, shiftStatusLabel() (+16 more)

### Community 41 - "Locations Directory Mapping"
Cohesion: 0.15
Nodes (24): LocationFormValues, COPY, LocationsWorkspaceHeader(), LocationsWorkspaceTab, averageCoverage(), buildDepartmentStats(), buildLocationStats(), coordinatesOf() (+16 more)

### Community 42 - "Overtime Rows"
Cohesion: 0.16
Nodes (20): buildOvertimeRows(), BuildOvertimeRowsInput, formatOvertimeHours(), OvertimeRow, overtimeStatus, OvertimeSummary, statusNote(), summariseOvertime() (+12 more)

### Community 43 - "Leave"
Cohesion: 0.14
Nodes (19): LeaveApprovalQueueCard(), LeaveApprovalQueueCardProps, QUEUE_ICON, LeaveFilterBar(), LeaveFilterBarProps, LeaveFilterOption, LeaveFilterSelect, LeaveQuickAction (+11 more)

### Community 44 - "Swaps"
Cohesion: 0.13
Nodes (19): SwapOverviewCard(), SwapOverviewCardProps, SwapParties(), SwapPartiesProps, CHIP, CHIP_LABEL, SwapShiftSide(), SwapShiftSideProps (+11 more)

### Community 45 - "Support Metrics"
Cohesion: 0.19
Nodes (21): averageCsat(), awaitingFirstResponse(), CaseLike, csatResponses(), formatMinutes(), isOpen(), median(), medianFirstResponseMinutes() (+13 more)

### Community 46 - "Platform Org Service"
Cohesion: 0.17
Nodes (20): AdminOrganisationDetailPage(), Detail, STATUS_TONE, Tab, TENANT_TABS, Row, getOrganisation(), getOrgSubscription() (+12 more)

### Community 47 - "Index"
Cohesion: 0.13
Nodes (20): DepartmentManager(), DepartmentManagerProps, createDepartment(), deleteDepartment(), updateDepartment(), AnnouncementUpdate, AppSettings, AppSettingsUpdate (+12 more)

### Community 48 - "Reports"
Cohesion: 0.16
Nodes (18): ReportFilterOption, ReportsFilterBar(), ReportsFilterBarProps, ReportsOverviewCard(), ReportsOverviewCardProps, ReportsOverviewSegment, ReportQuickAction, ReportsQuickActionsCard() (+10 more)

### Community 49 - "Report Prefs"
Cohesion: 0.21
Nodes (20): DATE, formatRunLabel(), read(), readFavourites(), readRuns(), recordRun(), TIME, toggleFavourite() (+12 more)

### Community 50 - "Database.Types"
Cohesion: 0.10
Nodes (14): ConnectorStats, OrgIntegration, SyncRun, AnnouncementRow, PlatformAnnouncement, CompositeTypes, Constants, DatabaseWithoutInternals (+6 more)

### Community 51 - "Reports"
Cohesion: 0.17
Nodes (17): RecentReport, RecentReportsCard(), RecentReportsCardProps, ReportChip(), ReportChipProps, ReportIcon(), ReportIconProps, ReportsTable() (+9 more)

### Community 52 - "Timesheets"
Cohesion: 0.17
Nodes (16): TimesheetStatusPill(), TimesheetStatusPillProps, TimesheetSummaryCard(), TimesheetSummaryCardProps, TimesheetTable(), TimesheetTableProps, countByStatus(), decimalHours() (+8 more)

### Community 53 - "Hours"
Cohesion: 0.14
Nodes (15): formatHours(), SegmentReviewReason, segmentsNeedingReview(), WorkedSegment, QUICK_ACTIONS, VIEWS, touchOrgActivity(), ClockEventRange (+7 more)

### Community 54 - "Leave"
Cohesion: 0.18
Nodes (15): LeaveBalancesCard(), LeaveBalancesCardProps, METER_WIDTH, LeaveRequestDraft, LeaveRequestModal(), LeaveRequestModalProps, TYPES, LeaveTypeChipProps (+7 more)

### Community 55 - "Shift Conflicts"
Cohesion: 0.16
Nodes (14): AssignShiftFormValues, AssignShiftModal(), blankValues(), valuesFromShift(), formatDayLabel(), ClashQuery, findClashingShift(), findExistingClashes() (+6 more)

### Community 56 - "App Boot Screen"
Cohesion: 0.15
Nodes (13): AppBootScreen(), AppBootScreenProps, BootFeature, BootStage, FEATURES, STAGE_COPY, ProtectedRoute(), AuthCallbackPage() (+5 more)

### Community 57 - "Ui"
Cohesion: 0.15
Nodes (11): AuthSplitLayoutProps, AuthTrustStrip(), CLAIMS, PublicFooter(), SplashWaves(), BrandMark(), BrandMarkProps, LanguagePill() (+3 more)

### Community 58 - "Leave"
Cohesion: 0.17
Nodes (13): LeaveReviewModal(), LeaveReviewModalProps, LeaveStatusPill(), LeaveStatusPillProps, COLUMNS, LeaveSortKey, LeaveTable(), LeaveTableProps (+5 more)

### Community 59 - "Invite Service"
Cohesion: 0.21
Nodes (14): formatExpiry(), ROLE_OPTIONS, TeamInviteManager(), SplashScreen(), AcceptInvitePage(), ROLE_LABELS, acceptInvite(), CreatedInvite (+6 more)

### Community 60 - "Ui"
Cohesion: 0.18
Nodes (12): ACTIONS, DepartmentQuickActions(), StaffMetricCard(), StaffMetricCardProps, StaffStatCard(), StaffStatCardProps, IconTile(), IconTileProps (+4 more)

### Community 61 - "Clockin Demo"
Cohesion: 0.23
Nodes (14): DEMO_ACTIVITY, DEMO_ATTENDANCE, DEMO_CLOCK_DATE, DEMO_CLOCK_TIME, DEMO_FOOTER, DEMO_HELP, DEMO_POLICY, DEMO_SCHEDULE (+6 more)

### Community 62 - "App"
Cohesion: 0.23
Nodes (13): isManager(), rotaWorkspaceTabs(), teamWorkspaceTabs(), AvailabilityPage(), AvailabilityStatus, STATUS_STYLE, toAvailabilityStatus(), WEEKDAYS (+5 more)

### Community 63 - "Feature Flag Service"
Cohesion: 0.23
Nodes (11): AdminFeatureFlagsPage(), Capability, countFlagTargets(), FeatureFlag, FeatureFlagChange, latestFlagChanges(), listFeatureFlags(), setFeatureFlag() (+3 more)

### Community 64 - "Reports Service"
Cohesion: 0.25
Nodes (14): ReportsAnalyticsCard(), listClockEventsForOrg(), getLeaveReportRows(), getShiftReportRows(), getSwapReportRows(), getTimesheetReportRows(), LeaveReportRow, reviewerNamesByProfileId() (+6 more)

### Community 65 - "Layout"
Cohesion: 0.23
Nodes (9): NavList(), Sidebar(), SidebarProps, ROLE_LABEL, SidebarOrgSwitcher(), SidebarOrgSwitcherProps, useFocusTrap(), NavItem (+1 more)

### Community 66 - "Timesheet Service"
Cohesion: 0.22
Nodes (7): FeatureAccess, useFeatureAccess(), supabase, Timesheet, TimesheetApproval, TimesheetStatus, Database

### Community 67 - "Ui"
Cohesion: 0.24
Nodes (9): ReportsAnalyticsCardProps, BarChart(), BarChartProps, BarGroup, BarSeries, niceMax(), CHART_SERIES, ChartSeriesColour (+1 more)

### Community 68 - "Rota"
Cohesion: 0.21
Nodes (11): CoverageList(), INSIGHT_SEVERITY, SEVERITY_TEXT, ShiftDetails(), ShiftInspectorPanel(), ShiftInspectorPanelProps, Tab, WarningsList() (+3 more)

### Community 69 - "Navigation Targets.Test"
Cohesion: 0.26
Nodes (10): ADMIN_NAV, ADMIN_SECONDARY_NAV, adminNavForRole(), CONSOLE_MENU_TARGET, APP_TSX, isRoutable(), readTag(), ROUTES (+2 more)

### Community 70 - "Tenant Health"
Cohesion: 0.26
Nodes (10): HEALTH_LABEL, healthBand, healthBreakdown(), TenantLike, tenantsActiveWithin(), TenantSubscriptionLike, daysAgo(), hoursAgo() (+2 more)

### Community 71 - "Layout"
Cohesion: 0.22
Nodes (10): AdminShell(), ConsoleIdentity(), ConsoleRail(), ConsoleRole(), environmentBadge(), NavList(), useCrumbs(), ConsoleRefreshContext (+2 more)

### Community 72 - "Splash Screen"
Cohesion: 0.31
Nodes (7): OfflineBanner(), FEATURES, SplashFeature, SplashScreenProps, StatusPill(), StatusPillProps, useOnlineStatus()

### Community 73 - "Staff"
Cohesion: 0.33
Nodes (9): BLANK, EmergencyContactsModal(), EmergencyContactsModalProps, useConfirm(), createEmergencyContact(), deleteEmergencyContact(), listEmergencyContacts(), EmergencyContact (+1 more)

### Community 74 - "Leave Demo"
Cohesion: 0.33
Nodes (7): LeaveView(), DEMO_LEAVE_APPROVALS, DEMO_LEAVE_BALANCES, DEMO_LEAVE_COUNTS, DEMO_LEAVE_PAGE_SIZE, DEMO_LEAVE_ROWS, DEMO_LEAVE_TOTAL

### Community 75 - "Swaps Demo"
Cohesion: 0.36
Nodes (7): DEMO_SWAP_ACTIVITY, DEMO_SWAP_COUNTS, DEMO_SWAP_PERIOD, DEMO_SWAP_QUICK_ACTIONS, DEMO_SWAP_ROWS, DEMO_SWAP_RULES, DEMO_SWAP_TOTAL

### Community 76 - "Smtp Settings Service"
Cohesion: 0.29
Nodes (9): SettingsIntegrationsPage(), deleteOrgSmtpSettings(), getOrgSmtpSettings(), saveOrgSmtpSettings(), testOrgSmtpSettings(), TestSmtpResult, updateOrgSmtpFields(), OrgSmtpSettingsInsert (+1 more)

### Community 77 - "Support Case Service"
Cohesion: 0.20
Nodes (3): PRIORITY_ORDER, SupportCase, SupportCaseMessage

### Community 78 - "Global Search"
Cohesion: 0.33
Nodes (7): GlobalSearch(), GROUP_ORDER, MANAGERIAL, SEARCH_ENTRIES, searchEntries(), SearchEntry, SearchGroup

### Community 79 - "Published Schedule"
Cohesion: 0.33
Nodes (8): PublishedScheduleChipProps, buildScheduleGroups(), computeScheduleTotals(), localDate(), localTime(), ScheduleChip, ScheduleRow, toChip()

### Community 80 - "Toast Context"
Cohesion: 0.22
Nodes (8): DURATION_MS, Toast, ToastContext, ToastContextValue, Toaster(), ToastProvider(), ToastVariant, VARIANT_STYLES

### Community 81 - "Rota Service"
Cohesion: 0.31
Nodes (8): createDraftRota(), CreateDraftRotaInput, findRotaForPeriod(), getOrCreateRotaForPeriod(), listRotasForPeriod(), RotaPeriodQuery, Rota, RotaUpdate

### Community 82 - "Ics"
Cohesion: 0.39
Nodes (7): RFC-5545, buildIcs(), downloadIcs(), escapeText(), fold(), IcsOptions, toIcsStamp()

### Community 83 - "Reports Demo"
Cohesion: 0.36
Nodes (4): DEMO_OVERVIEW, DEMO_RECENT_REPORTS, DEMO_REPORTS, QUICK_ACTIONS

### Community 84 - "Marketing"
Cohesion: 0.29
Nodes (6): AGENDA, CHIP, DAYS, METRICS, ProductPreview(), ROWS

### Community 85 - "Staff"
Cohesion: 0.33
Nodes (6): AvailabilityWeekList(), AvailabilityWeekListProps, DATE, DOT, WEEKDAY, AvailabilityDay

### Community 86 - "Use P W A Install"
Cohesion: 0.53
Nodes (4): InstallPrompt(), BeforeInstallPromptEvent, detectInstalled(), usePWAInstall

### Community 87 - "Leave"
Cohesion: 0.40
Nodes (5): LeaveOverviewCard(), LeaveOverviewCardProps, LeaveTypeCount, LEAVE_TYPE_DOT, LEAVE_TYPE_STROKE

### Community 88 - "Theme Context"
Cohesion: 0.47
Nodes (5): getInitialTheme(), ThemeContext, ThemeContextValue, ThemeProvider(), ThemeMode

### Community 89 - "Leave"
Cohesion: 0.50
Nodes (4): LeavePagination(), LeavePaginationProps, PAGE_SIZES, pageItems()

### Community 90 - "Imagekit"
Cohesion: 0.70
Nodes (3): useOptimizedImage(), buildImageKitUrl(), ImageTransform

## Knowledge Gaps
- **744 isolated node(s):** `FeaturesPage`, `SolutionsPage`, `PricingPage`, `ResourcesPage`, `AboutPage` (+739 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `Ui` to `Marketing`, `Announcements`, `Admin`, `Staff`, `Onboarding`, `Schedule`, `Availability`, `Staff Directory Mapping`, `Ui`, `Auth`, `App`, `Rota Builder Preview Page`, `Clockin`, `Staff`, `Layout`, `Rota`, `Rota Insights`, `App`, `Org Preferences`, `Timesheets`, `Layout`, `Locations`, `Locations`, `Rota`, `Swaps`, `Platform Overview`, `Locations`, `App`, `Overtime Rows`, `Leave`, `Swaps`, `Reports`, `Reports`, `Timesheets`, `Hours`, `Leave`, `App Boot Screen`, `Ui`, `Leave`, `Ui`, `App`, `Layout`, `Ui`, `Rota`, `Layout`, `Splash Screen`, `Global Search`, `Toast Context`, `Staff`, `Leave`, `Leave`?**
  _High betweenness centrality (0.165) - this node is a cross-community bridge._
- **Why does `Card()` connect `Marketing` to `Announcements`, `Staff`, `Onboarding`, `Schedule`, `Availability`, `Ui`, `Auth`, `App`, `Rota Builder Preview Page`, `Clock Rows`, `Clockin`, `Staff`, `Admin`, `Layout`, `App`, `Org Preferences`, `Timesheets`, `Layout`, `Ui`, `Locations`, `Locations`, `Swap Service`, `Incident Metrics`, `Swaps`, `Leave Rows`, `App`, `Locations Directory Mapping`, `Overtime Rows`, `Leave`, `Swaps`, `Support Metrics`, `Platform Org Service`, `Reports`, `Reports`, `Timesheets`, `Hours`, `Leave`, `Invite Service`, `Ui`, `App`, `Feature Flag Service`, `Ui`, `Reports Demo`, `Leave`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `reportError()` connect `App` to `Marketing`, `Announcements`, `Admin`, `Onboarding`, `Staff Directory Mapping`, `Ui`, `Auth`, `Rota Builder Preview Page`, `Clock Rows`, `Admin`, `Layout`, `Rota Insights`, `App`, `Org Preferences`, `Offline Outbox`, `Layout`, `Swap Service`, `Rota`, `Incident Metrics`, `Platform Overview`, `Leave Rows`, `Locations Directory Mapping`, `Overtime Rows`, `Support Metrics`, `Platform Org Service`, `Index`, `Report Prefs`, `Hours`, `Invite Service`, `App`, `Feature Flag Service`, `Reports Service`, `Ui`, `Staff`, `Smtp Settings Service`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **What connects `FeaturesPage`, `SolutionsPage`, `PricingPage` to the rest of the system?**
  _744 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin Overview Demo` be split into smaller, more focused modules?**
  _Cohesion score 0.014492753623188406 - nodes in this community are weakly interconnected._
- **Should `Marketing` be split into smaller, more focused modules?**
  _Cohesion score 0.04300047778308648 - nodes in this community are weakly interconnected._
- **Should `App` be split into smaller, more focused modules?**
  _Cohesion score 0.024977960622979724 - nodes in this community are weakly interconnected._