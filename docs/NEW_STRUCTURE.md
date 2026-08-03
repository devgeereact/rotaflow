You are a senior product designer, UX architect, SaaS design-system specialist, and full-stack software engineer.

Your task is to rebuild the complete RotaFlow workforce scheduling platform as a polished, responsive, production-quality web application and installable Progressive Web App.

Do not create a static dashboard mock-up. Build a functional application with working navigation, interactive controls, connected screens, realistic application state, reusable components, responsive layouts, and persistent demo data.

The application must feel like one coherent product. Every screen, component, button, table, modal, filter, status badge, chart, and workflow must use the same RotaFlow design system.

Do not redesign the visual identity into a different product. Maintain the established RotaFlow visual direction:

• Modern workforce-management SaaS
• Clean, professional, operational, and trustworthy
• Light mode as the primary experience
• Deep navy typography
• RotaFlow blue as the primary brand colour
• Soft blue-grey application backgrounds
• White cards with subtle borders and restrained shadows
• Rounded but not excessively rounded interfaces
• Dense but breathable information layouts
• Enterprise-quality tables and scheduling tools
• Clear visual hierarchy
• Accessible colour contrast
• Minimal visual noise
• No excessive gradients
• No glassmorphism
• No oversized typography
• No cartoon illustrations
• No generic “AI-generated dashboard” styling
• No random colours or inconsistent component treatments

The platform is called:

RotaFlow

Product tagline:

Smarter Rota. Stronger Teams.

Product description:

RotaFlow is an all-in-one workforce scheduling and management platform that enables organisations to create rotas, manage employees, monitor availability, process leave and shift swaps, track attendance, review timesheets, communicate with teams, generate reports, manage locations, and maintain operational compliance.

The platform must support organisations across:

• Healthcare and care homes
• Hospitality
• Retail
• Education
• Security
• Facilities management
• Multi-site service organisations

Use the following demonstration organisation throughout the application:

Organisation:
Sunnyvale Care Group

Primary location:
Sunnyvale Care Home

Additional locations:
Westview Care Home
Riverside Support Centre

Example departments:

• Care Home – Floor 1
• Care Home – Floor 2
• Care Home – Floor 3
• Nursing
• Kitchen
• Maintenance
• Administration
• Head Office

Current signed-in user:

Name:
Sarah Manager

Role:
Manager

Department:
Operations

Organisation:
Sunnyvale Care Group

Location:
Sunnyvale Care Home

Use realistic UK names, UK dates, British English, UK time formatting, UK phone formatting, and UK employment terminology.

Use realistic staff names and workforce information. Do not use lorem ipsum.

==================================================
1. CORE PRODUCT REQUIREMENTS
==================================================

Build the application as a complete interactive product rather than a collection of disconnected pages.

The application must include:

• Functional sidebar navigation
• Functional top navigation
• Functional organisation switcher
• Working profile menu
• Working search interface
• Working notifications panel
• Responsive layouts
• Desktop, tablet, and mobile support
• Persistent application state
• Reusable UI components
• Working forms
• Working validation
• Working modals
• Working drawers
• Working dropdown menus
• Working tabs
• Working filters
• Working search fields
• Working sorting
• Working pagination
• Working tables
• Working date controls
• Working calendar controls
• Working status updates
• Working confirmation dialogs
• Working toast notifications
• Empty states
• Loading states
• Error states
• Success states
• Permission-aware navigation
• Accessible keyboard interaction
• Clear focus states

Do not leave buttons visually present but non-functional.

Every primary button must perform an action.

Every secondary button must either perform an action, open a modal, open a drawer, change a view, or navigate to another screen.

Every navigation item must lead to a working page.

Every table action menu must open and provide functional actions.

Every form must validate required fields.

Every destructive action must require confirmation.

Every successful action must display a clear success notification.

Where a real backend is unavailable, use a structured mock data layer with local persistence.

Use local storage, indexed storage, or a client-side data store so that user actions remain visible after navigation and page refresh.

==================================================
2. USER ROLES AND PERMISSIONS
==================================================

Support the following membership roles:

1. Owner

2. Manager

3. Staff

Do not treat Super Admin as a standard organisation membership role.

Super Admin is a separate platform-level permission and must only access the platform administration area.

Role permissions:

OWNER

Can:

• Manage organisation settings
• Manage locations
• Manage departments
• Manage staff
• Invite users
• Manage roles and permissions
• Create and publish rotas
• Approve leave
• Approve shift swaps
• Review timesheets
• Access reports
• Manage billing
• Manage integrations
• Access audit information
• Manage organisation policies

MANAGER

Can:

• View organisation information
• Manage staff
• Create and edit rotas
• Publish rotas
• Review availability
• Approve leave
• Approve swaps
• Review attendance
• Review timesheets
• Create announcements
• Access reports
• Manage operational locations where permitted

STAFF

Can:

• View personal schedule
• View upcoming shifts
• Submit availability
• Request leave
• Request shift swaps
• Request overtime
• Clock in and out
• View personal timesheets
• View announcements
• Update personal profile
• Manage personal notification preferences
• View personal attendance information

Role-based navigation must update dynamically.

Do not show manager-only pages to staff users.

If a user attempts to access a restricted route, show an accessible permission-denied screen with:

• Clear explanation
• Current role
• Required permission
• Back-to-dashboard button

==================================================
3. DESIGN SYSTEM
==================================================

Create a reusable RotaFlow design system.

Typography:

Use:

Inter

Fallback:

system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif

Typography scale:

Display:
48–64px

Page title:
30–36px

Section title:
20–24px

Card title:
16–18px

Body:
14–16px

Supporting text:
12–14px

Use strong hierarchy and avoid excessively bold body text.

Colour system:

Primary blue:

#2563C9

Primary dark:

#173B78

Primary light:

#EAF2FF

Navy text:

#17233C

Primary body text:

#334155

Secondary text:

#64748B

Muted text:

#94A3B8

Application background:

#F5F8FC

Card background:

#FFFFFF

Border:

#E2E8F0

Success:

#16824A

Success background:

#EAF8F0

Warning:

#C67A08

Warning background:

#FFF7E6

Danger:

#D83A3A

Danger background:

#FFF0F0

Information:

#2563C9

Information background:

#EEF5FF

Use colour to support meaning, not as the only method of communicating status.

Spacing scale:

4px
8px
12px
16px
20px
24px
32px
40px
48px
64px

Border radius:

Small controls:
6px

Inputs:
8px

Cards:
12px

Large feature panels:
16px

Do not use pill-shaped cards.

Shadows:

Use subtle shadows only.

Default card:

0 1px 2px rgba(15, 23, 42, 0.04)

Elevated panel:

0 8px 24px rgba(15, 23, 42, 0.08)

Avoid strong floating shadows.

Buttons:

Primary:

Blue background
White text
8px radius

Secondary:

White background
Blue border
Blue text

Tertiary:

Transparent background
Blue text

Danger:

Red background
White text

Buttons must support:

• Default
• Hover
• Active
• Focus
• Disabled
• Loading

Inputs:

• 44px minimum height
• Clear labels
• Helpful placeholder text
• Validation messages
• Accessible focus states
• Optional helper text

Status badges:

Use restrained colour-coded badges for:

• Active
• Inactive
• Pending
• Approved
• Declined
• Draft
• Published
• Open
• Filled
• On Leave
• Probation
• Upcoming
• Completed
• Critical

Cards:

• White background
• 1px border
• 12px radius
• 20–24px internal padding
• Clear title and supporting information
• Consistent header alignment

Tables:

• Sticky header where appropriate
• Row hover state
• Optional row selection
• Sortable columns
• Responsive overflow handling
• Empty state
• Pagination
• Row action menu

==================================================
4. GLOBAL APPLICATION SHELL
==================================================

Desktop application layout:

Left sidebar:

Width:

256px

The sidebar contains:

RotaFlow logo

Tagline:

WORKFORCE SCHEDULING

Organisation switcher:

Sunnyvale Care Group

3 locations

Primary navigation:

• Dashboard
• Rota Builder
• Schedule
• Team
• Availability
• Leave
• Swaps
• Timesheets
• Clock In
• Reports
• Announcements
• Locations
• Settings
• Integrations

Profile section:

Sarah Manager

Manager

Help and Support

Collapse sidebar control

Sidebar behaviour:

• Active item has a soft blue background
• Active item uses blue iconography and stronger text
• Hover states are visible
• Collapsed mode shows icons with tooltips
• Mobile mode converts to a slide-out navigation drawer

Top application header:

• Global search
• Keyboard shortcut indicator
• Notifications button
• Help button
• Profile avatar
• User name
• User role
• Profile menu

Global search:

Search across:

• Staff
• Shifts
• Locations
• Departments
• Leave requests
• Reports
• Announcements

Search results must be grouped by content type.

Profile menu:

• My Profile
• Preferences
• Security
• Connected Accounts
• Sessions
• Activity
• Help Centre
• Sign Out

Notifications:

Include:

• Shift reminders
• Leave approvals
• Swap requests
• Rota publications
• Attendance alerts
• Announcements

Notifications must support:

• Mark as read
• Mark all as read
• Open related item
• Notification filtering

==================================================
5. PUBLIC WEBSITE
==================================================

Build a complete marketing website.

Routes:

/

Features:

/features

Solutions:

/solutions

Pricing:

/pricing

Resources:

/resources

About:

/about

Contact:

/contact

Login:

/login

Start Free Trial:

/signup

Landing page structure:

1. Header

Logo:

RotaFlow

Navigation:

• Features
• Solutions
• Pricing
• Resources
• Contact

Actions:

• Log In
• Start Free Trial

2. Hero

Headline:

Smart Schedules.
Stronger Teams.
Better Business.

Supporting copy:

RotaFlow brings scheduling, staff management, attendance, leave, shift swaps, reporting, and workforce operations together in one easy-to-use platform.

Primary CTA:

Start Free Trial

Secondary CTA:

Book a Demo

Trust message:

14-day free trial

No credit card required

Cancel anytime

Show a realistic RotaFlow dashboard preview and a mobile schedule preview.

3. Product benefits

• Smart Scheduling
• Staff Management
• Time and Attendance
• Leave and Shift Swaps
• Automated Workflows
• Reporting and Insights
• Multi-location Management
• Integrations and Data Export

4. Industry solutions

• Healthcare
• Hospitality
• Retail
• Education
• Security
• Facilities Management

5. Platform statistics

Use realistic demonstration values:

10,000+

Active users

500+

Organisations

100,000+

Shifts scheduled

99.9%

Platform uptime

6. Why teams choose RotaFlow

• Save time
• Reduce scheduling errors
• Improve staff communication
• Maintain compliance
• Increase workforce visibility

7. Customer testimonial

Use a realistic testimonial from:

Sarah Thompson

Operations Manager

CarePlus

8. Final CTA

Headline:

Ready to Simplify Your Scheduling?

Buttons:

Start Free Trial

Book a Demo

9. Footer

• Product
• Solutions
• Resources
• Company
• Legal
• Support
• Privacy
• Terms
• Cookie settings

All marketing navigation and CTAs must work.

==================================================
6. AUTHENTICATION AND ONBOARDING
==================================================

Create:

• Splash screen
• Application boot screen
• Sign in
• Sign up
• Forgot password
• Reset password
• Email verification
• Magic-link confirmation
• Accept invitation
• Create organisation onboarding
• Organisation switcher
• Sign-out confirmation

Splash screen:

Display:

RotaFlow logo

Smarter Rota. Stronger Teams.

Subtle loading indicator

Application boot screen:

Show:

• Restoring session
• Loading organisation
• Checking permissions
• Preparing workspace

Sign-in screen:

Fields:

Email address

Password

Controls:

Remember me

Forgot password

Sign in

Continue with Google

Continue with Microsoft

Magic link

Link:

Create an account

Sign-up screen:

Fields:

First name

Last name

Work email

Organisation name

Password

Confirm password

Checkbox:

Agree to Terms and Privacy Policy

Forgot password:

Email input

Send reset link

Success confirmation

Accept invitation:

• Organisation information
• Invited role
• Invitation email
• Accept invitation
• Decline invitation

Onboarding:

Step 1:

Organisation details

Step 2:

Industry

Step 3:

Locations

Step 4:

Departments

Step 5:

Working week and timezone

Step 6:

Invite team members

Step 7:

Completion

Include:

• Progress indicator
• Back button
• Continue button
• Save and exit
• Validation
• Completion screen

==================================================
7. DASHBOARD
==================================================

Route:

/app/dashboard

Build a comprehensive operational dashboard.

Header:

Good morning, Sarah

Overview of your organisation today

Date range:

12–18 May 2026

Primary action:

Create Rota

Secondary actions:

Export

Filters

Metric cards:

Total Staff:

248

On Shift Today:

41

Shift Coverage:

92%

Open Shifts:

23

Pending Leave:

7

Weekly rota:

Staff-by-day schedule

Include:

• Morning shifts
• Day shifts
• Night shifts
• Time ranges
• Location labels
• Staff avatars
• Open shift indicators
• Coverage status

Dashboard sections:

• Upcoming shifts
• Pending leave
• Pending swaps
• Attendance status
• Open shifts
• Recent activity
• Announcements
• Workforce coverage
• Weekly hours
• Compliance alerts

Every dashboard card must link to the relevant page.

==================================================
8. ROTA BUILDER
==================================================

Route:

/app/rota

Build an advanced interactive rota builder.

Required features:

• Weekly view
• Daily view
• Location selector
• Department selector
• Date navigation
• Current week button
• Copy previous week
• Copy rota
• Clear rota
• Save draft
• Publish rota
• Unpublish rota
• Auto-fill rota
• Shift templates
• Add shift
• Add staff
• Coverage metrics
• Labour hours
• Labour cost estimate
• Conflict warnings
• Rest-period warnings
• Availability warnings
• Qualification warnings
• Open-shift indicators

Use a staff-by-day scheduling grid.

Rows:

Staff members

Columns:

Days of the week

Shift cells:

• Early
• Day
• Late
• Night
• Off
• Leave
• Open

Support:

• Drag and drop
• Click to assign
• Edit shift modal
• Remove shift
• Duplicate shift
• Add note
• Assign location
• Assign department
• Assign shift type

Publish workflow:

Click Publish Rota

Open confirmation modal showing:

• Date range
• Number of shifts
• Assigned shifts
• Open shifts
• Conflicts
• Staff notification option

Confirm publication

Show success toast

Update rota status to Published

==================================================
9. SCHEDULE
==================================================

Route:

/app/schedule

Provide:

• My Schedule
• Team Schedule
• Day view
• Week view
• Month view
• Agenda view

Controls:

• Previous period
• Next period
• Today
• Date picker
• View selector
• Location filter
• Department filter
• Export
• Subscribe to calendar

Staff schedule:

• Upcoming shifts
• Shift details
• Location
• Department
• Break
• Notes
• Shift status

Support:

• Download ICS
• Calendar subscription
• Print schedule

==================================================
10. TEAM MANAGEMENT
==================================================

Route:

/app/team

Build a comprehensive workforce directory.

Header:

Team

Manage your team members, roles and permissions.

Actions:

• Export
• Invite Staff
• Add Staff

Metrics:

Total Staff:

248

Active Staff:

236

On Shift Today:

41

On Leave:

15

New This Month:

8

Filters:

• Search
• Department
• Role
• Status
• Location
• Employment type
• More filters

Team table:

Columns:

• Selection
• Staff member
• Role
• Department
• Location
• Employment status
• Account status
• Next shift
• Actions

Staff information:

• Avatar
• Name
• Work email
• Role
• Department
• Location
• Status
• Next shift

Actions:

• View profile
• Edit
• Assign shift
• View schedule
• Reset password
• Deactivate

Right panel:

• Team overview
• Role distribution
• Department distribution
• Quick actions
• Recent joiners

Add Staff modal:

Fields:

• First name
• Last name
• Work email
• Phone
• Job title
• Role
• Department
• Location
• Employment type
• Start date
• Weekly contracted hours

Options:

• Send invitation immediately
• Create without invitation

Validation and save behaviour must work.

==================================================
11. STAFF PROFILE
==================================================

Route:

/app/team/:staffId

Tabs:

• Overview
• Schedule
• Availability
• Leave
• Timesheets
• Qualifications
• Documents
• Emergency Contacts
• Activity

Overview:

• Profile image
• Name
• Role
• Employment status
• Contact information
• Department
• Location
• Start date
• Contracted hours
• Manager

Show:

• Upcoming shifts
• Weekly hours
• Leave balance
• Attendance
• Qualifications
• Compliance status
• Recent activity

Actions:

• Edit profile
• Assign shift
• Request document
• Add qualification
• Deactivate staff member

==================================================
12. AVAILABILITY
==================================================

Route:

/app/availability

Staff view:

• Weekly availability
• Available
• Preferred
• Unavailable
• Recurring availability
• One-off availability
• Submission status

Actions:

• Add availability
• Edit availability
• Copy week
• Submit availability

Manager view:

• Team availability matrix
• Location filter
• Department filter
• Submission status
• Coverage indicators
• Availability conflicts

==================================================
13. LEAVE
==================================================

Route:

/app/leave

Staff view:

• Leave balance
• New leave request
• Pending requests
• Approved leave
• Declined leave
• Leave history

Request form:

• Leave type
• Start date
• End date
• Partial day
• Reason
• Supporting document

Manager view:

• Pending requests
• Team calendar
• Approval queue
• Leave balances
• Department impact

Actions:

• Approve
• Decline
• Request more information
• Edit
• Cancel

Approval must update status and notify the employee.

==================================================
14. SHIFT SWAPS
==================================================

Route:

/app/swaps

Staff features:

• Create swap request
• Select owned shift
• Select colleague
• Add message
• Submit request

Show:

• Pending
• Accepted
• Declined
• Approved
• Cancelled

Manager features:

• Review requests
• Check coverage
• Check qualifications
• Check rest periods
• Approve
• Decline

Approved swaps must update the rota.

==================================================
15. CLOCK IN AND OUT
==================================================

Route:

/app/clock-in

Build the clock-in screen using the established RotaFlow style.

Header:

Clock In

Track your attendance and stay on schedule.

Important policy banner:

Please clock in within 15 minutes of your scheduled start time.

Current shift card:

Shift:

09:00–17:00

Date:

Thursday, 14 May 2026

Location:

Sunnyvale Care Home

Department:

Care Home – Floor 2

Role:

Senior Care Assistant

Shift type:

Day Shift

Break:

12:30–13:00

Paid hours:

7h 30m

Central attendance panel:

• Live clock
• Current date
• Time-window status
• Clock In Now button
• Fingerprint or attendance icon
• Scan QR Code
• Clock in using PIN
• Location verification message

After clocking in:

Change button to:

Clock Out

Display:

Clocked in at 09:02

Current worked duration

Start break

End break

Clock out

Right panels:

• Today’s schedule
• Recent attendance activity
• Help and support

Lower panels:

• Weekly summary
• Scheduled hours
• Worked hours
• Break hours
• Variance
• Attendance status

Clock-in behaviour:

1. User clicks Clock In Now

2. Show location verification state

3. Record time

4. Update current shift status

5. Add attendance event

6. Show success toast

7. Change primary action to Clock Out

Clock-out behaviour:

1. Confirm clock-out

2. Calculate worked time

3. Deduct unpaid break

4. Save attendance record

5. Update weekly summary

6. Add activity item

7. Show confirmation

Include:

• GPS permission state
• QR fallback
• PIN fallback
• Offline queue
• Synchronisation status

==================================================
16. TIMESHEETS
==================================================

Route:

/app/timesheets

Staff:

• Weekly timesheets
• Worked hours
• Breaks
• Overtime
• Exceptions
• Submission status

Manager:

• Review queue
• Approve timesheet
• Reject timesheet
• Request correction
• Bulk approval
• Export payroll data

Table:

• Employee
• Period
• Scheduled hours
• Worked hours
• Breaks
• Overtime
• Variance
• Status
• Actions

==================================================
17. REPORTS
==================================================

Route:

/app/reports

Report categories:

• Rota coverage
• Staffing levels
• Labour hours
• Labour costs
• Attendance
• Absence
• Leave
• Shift swaps
• Overtime
• Staff utilisation
• Compliance
• Location performance

Features:

• Date range
• Location filter
• Department filter
• Report type
• Save report
• Favourite report
• Schedule report
• Export CSV
• Export XLSX
• Export PDF

Provide:

• Summary cards
• Charts
• Data tables
• Download actions

==================================================
18. ANNOUNCEMENTS
==================================================

Route:

/app/announcements

Manager features:

• Create announcement
• Draft
• Schedule
• Publish
• Edit
• Duplicate
• Archive
• Delete

Fields:

• Title
• Message
• Audience
• Location
• Department
• Priority
• Publish date
• Expiry date
• Attachment

Metrics:

• Sent
• Delivered
• Read
• Unread

Staff view:

• Announcement feed
• Priority labels
• Read status
• Attachments
• Search
• Filters

==================================================
19. LOCATIONS
==================================================

Route:

/app/locations

Features:

• Location list
• Location cards
• Add location
• Edit location
• Archive location
• Department management
• Location manager
• Address
• Timezone
• Capacity
• Staffing requirement
• Operating hours

Location detail:

• Overview
• Departments
• Staff
• Rota
• Coverage
• Activity

==================================================
20. SETTINGS
==================================================

Route:

/app/settings

Settings sections:

Organisation

Permissions

Roles

Policies

Notifications

Integrations

Billing

Audit

Organisation screen:

• Organisation name
• Organisation logo
• Industry pack
• Organisation address
• Primary contact
• Sites
• Departments
• Week start day
• Timezone
• Role display labels
• Platform support access
• Support access expiry
• Access history

Permissions:

• Role permission matrix
• Module permissions
• View
• Create
• Edit
• Delete
• Approve
• Publish
• Export

Roles:

• Owner
• Manager
• Staff
• Custom roles

Policies:

• Minimum notice
• Maximum consecutive shifts
• Minimum rest period
• Weekend rules
• Overtime rules
• Leave rules
• Shift swap rules
• Availability rules
• Qualification rules
• Publishing rules

Notifications:

• In-app
• Email
• SMS
• Push

Categories:

• Shift reminders
• Rota published
• Leave updates
• Swap requests
• Announcements
• Attendance alerts

Integrations:

• Payroll
• HR
• Microsoft 365
• Google Calendar
• Slack
• Teams
• Webhooks
• API keys

Billing:

• Current plan
• Usage
• Staff limit
• Location limit
• Payment method
• Billing contact
• Invoices
• VAT receipts
• Subscription management

Audit:

• Event summary
• User activity
• Event type
• Location
• Severity
• IP address
• Date range
• Export audit log
• Retention policy

==================================================
21. MY PROFILE
==================================================

Route:

/app/profile

Tabs:

• Personal Information
• Preferences
• Security
• Connected Accounts
• Sessions
• API and Apps
• Activity

Personal Information:

• Profile photo
• Full name
• Work email
• Phone
• Job title
• Department
• Preferred language
• About me

Notification preferences:

• Shift reminders
• Rota published
• Swap requests
• Leave updates
• Announcements

Channels:

• In-app
• Email
• SMS
• Push

Preferences:

• Language
• Week starts on
• Time format
• Date format
• Timezone
• Default login view
• Default rota range
• Theme
• Display density
• Currency
• Show shift locations
• Show staff photos
• Show role colours
• Show shift end times
• Show staffing indicators
• Show budgets and costs
• Default calendar
• Auto-refresh
• Show past shifts
• Highlight my shifts

Security:

• Password
• Two-factor authentication
• Backup codes
• Recovery email
• Login alerts
• Trusted devices
• Session timeout
• Restrict concurrent sessions
• Security health score
• Recent security activity

Connected Accounts:

• Google
• Microsoft
• Apple
• Other connected services

Sessions:

• Current device
• Browser
• Location
• Last activity
• Sign out session
• Sign out all other sessions

Activity:

• Profile changes
• Preference changes
• Security changes
• Login history

==================================================
22. MOBILE EXPERIENCE
==================================================

Create responsive mobile screens.

Mobile bottom navigation:

• Home
• Schedule
• Clock In
• Requests
• More

Mobile features:

• Quick clock-in
• Upcoming shift
• Weekly schedule
• Leave request
• Shift swap
• Notifications
• Profile
• Offline status

The mobile experience must not simply shrink the desktop interface.

Use mobile-specific layouts and interaction patterns.

==================================================
23. PWA REQUIREMENTS
==================================================

Build RotaFlow as an installable Progressive Web App.

Include:

• Web app manifest
• Application icons
• Install prompt
• Offline fallback
• Service worker
• Cached application shell
• Offline indicator
• Background synchronisation
• Offline attendance queue
• Update available prompt

When offline:

• Display an offline banner
• Allow supported actions to queue
• Show pending synchronisation count

When back online:

• Automatically synchronise queued actions
• Show synchronisation progress
• Show success confirmation

==================================================
24. INTERACTION REQUIREMENTS
==================================================

All interactions must be functional.

Buttons:

Every button must:

• Navigate
• Open a modal
• Submit a form
• Change application state
• Trigger an export
• Open a menu
• Perform a relevant action

Do not include decorative buttons with no behaviour.

Forms:

• Validate fields
• Display inline errors
• Prevent invalid submission
• Show loading state
• Show success notification
• Persist changes

Modals:

Required modals:

• Add staff
• Edit staff
• Invite staff
• Add shift
• Edit shift
• Publish rota
• Create leave request
• Approve leave
• Decline leave
• Create swap request
• Approve swap
• Clock out confirmation
• Add location
• Edit location
• Create announcement
• Delete confirmation
• Sign-out confirmation

Tables:

• Search
• Sort
• Filter
• Pagination
• Row selection
• Bulk actions
• Row action menu

Date controls:

• Previous
• Next
• Today
• Date picker
• Range selection

Notifications:

Use toast messages for:

• Saved
• Updated
• Created
• Published
• Approved
• Declined
• Deleted
• Export started
• Export completed
• Synchronised
• Error

==================================================
25. DATA AND STATE
==================================================

Create a structured application data model.

Entities:

Organisation

Location

Department

User

Membership

Staff profile

Role

Permission

Shift type

Shift template

Rota

Shift

Availability

Leave request

Shift swap

Overtime request

Clock event

Timesheet

Announcement

Notification

Document

Qualification

Emergency contact

Audit event

Integration

Subscription

Use realistic seeded data.

The application must demonstrate:

• 248 staff members
• Multiple locations
• Multiple departments
• Different roles
• Active and inactive staff
• Staff on leave
• Upcoming shifts
• Open shifts
• Pending leave requests
• Pending swaps
• Attendance records
• Published and draft rotas
• Announcements
• Audit events

Changes made in the application must update related screens.

Examples:

If a manager approves leave:

• Leave status updates
• Staff leave balance updates
• Team calendar updates
• Rota shows leave status
• Notification is created
• Audit event is created

If a shift is swapped:

• Shift ownership updates
• Schedule updates
• Staff schedule updates
• Notification is created
• Audit event is created

If a user clocks in:

• Attendance updates
• Current shift updates
• Weekly hours update
• Timesheet updates
• Activity updates

==================================================
26. ACCESSIBILITY
==================================================

Meet WCAG 2.2 AA standards where practical.

Include:

• Keyboard navigation
• Visible focus states
• Semantic HTML
• Accessible labels
• Accessible form errors
• Colour-independent status indicators
• Sufficient contrast
• Screen-reader-friendly navigation
• Reduced-motion support

==================================================
27. RESPONSIVE BREAKPOINTS
==================================================

Desktop:

1440px and above

Large tablet:

1024–1439px

Tablet:

768–1023px

Mobile:

Below 768px

Ensure:

• Sidebar collapses appropriately
• Tables become horizontally scrollable or card-based
• Filters collapse into drawers
• Multi-column dashboards stack logically
• Modals fit smaller screens
• Forms remain usable
• Touch targets are at least 44px

==================================================
28. QUALITY REQUIREMENTS
==================================================

The finished application must:

• Feel cohesive
• Use consistent spacing
• Use consistent card styles
• Use consistent button styles
• Use consistent typography
• Use realistic operational data
• Have no broken routes
• Have no dead buttons
• Have no empty placeholder pages
• Have no lorem ipsum
• Have no duplicate navigation labels
• Have no inconsistent icons
• Have no excessive gradients
• Have no visual clutter
• Have no generic dashboard appearance
• Have no unresolved TypeScript errors
• Have no console errors
• Have no broken responsive layouts

Use a consistent icon library.

Recommended:

Lucide Icons

Use icons purposefully and consistently.

==================================================
29. FINAL ACCEPTANCE CHECKLIST
==================================================

> **STATUS — updated 2026-08-03, branch `feat/new-structure`.**
>
> Legend:
> - `[x] ✅` built **and** evidenced this session — by an automated test, by a
>   measurement, or by reading the wired code path end to end.
> - `[~] ⬜` built and routed, but **not exercised at runtime by me**. Treat as
>   unproven, not as working.
> - `[ ]` not built. Each is named in "Still outstanding" below.
>
> **What this session changed.** Every "coming soon" toast and every silent
> `() => undefined` handler in the application is gone — 30 controls across
> Leave, Timesheets, Rota Builder, Schedule, Announcements, Swaps, Locations
> and the sidebar now perform a real action. A repository-wide grep for
> "coming soon", "not built yet" and no-op handlers returns nothing outside the
> DEV-only design-preview routes.
>
> **Responsiveness is measured, not eyeballed.** Eleven screens × four
> breakpoints (390 / 768 / 1024 / 1440), comparing `scrollWidth` against
> `clientWidth` over CDP at a true emulated viewport. The dashboard is clean at
> all four. Two real page-level overflows were found and fixed (Clock-in's
> security footer, the Rota Builder toolbar). Wide elements that remain are
> `min-w-[Xrem]` tables inside `overflow-x-auto` containers — §27's intended
> pattern, where the table scrolls and the page does not.
>
> **Still outstanding — not built, and not claimed:**
> - `/admin/*` platform administration (7 screens: tenants, platform users,
>   platform billing, support tools, platform audit, feature flags). Super
>   Admin is a platform-level permission with no screens behind it yet.
> - `/app/overtime`. `overtime_requests` still has no reader and no writer
>   (audit01 P2-7).
> - `/app/locations/:locationId` as its own route. The detail panel exists
>   inside `/app/locations`; three of its tabs are honest "not built yet" notes.
> - Connected Accounts profile tab (`/app/profile/accounts`).
> - Timesheet "request correction" and per-row reject. Bulk approve, reopen and
>   payroll export are built.
> - Notification **delivery** end to end. The infrastructure is verified — VAPID
>   keys pair, SMTP authenticates and delivers, Inngest reaches the function —
>   but no push has been observed arriving on a real device. See audit01 §7b.

Before completing the build, verify:

APPLICATION

[~] ⬜ Splash screen works

[~] ⬜ App boot works

[~] ⬜ Sign in works

[~] ⬜ Sign up works

[~] ⬜ Password reset works

[~] ⬜ Organisation onboarding works

[x] ✅ Sidebar navigation works

[x] ✅ Top navigation works

[x] ✅ Profile menu works

[~] ⬜ Notifications work

[x] ✅ Search works

DASHBOARD

[x] ✅ Dashboard cards work

[x] ✅ Dashboard links work

[~] ⬜ Date filters work

[x] ✅ Coverage information is displayed

ROTA

[x] ✅ Rota builder works

[x] ✅ Shifts can be added

[x] ✅ Shifts can be edited

[x] ✅ Shifts can be removed

[x] ✅ Staff can be assigned

[~] ⬜ Drag and drop works

[~] ⬜ Conflicts are displayed

[x] ✅ Rota can be saved

[x] ✅ Rota can be published

TEAM

[x] ✅ Staff can be searched

[x] ✅ Staff can be filtered

[~] ⬜ Staff can be added

[~] ⬜ Staff can be edited

[~] ⬜ Staff can be invited

[x] ✅ Staff profiles work

STAFF OPERATIONS

[~] ⬜ Availability works

[x] ✅ Leave requests work

[x] ✅ Leave approval works

[x] ✅ Shift swaps work

[~] ⬜ Clock in works

[~] ⬜ Clock out works

[~] ⬜ Attendance updates work

[x] ✅ Timesheets work

REPORTING

[x] ✅ Reports work

[x] ✅ Filters work

[x] ✅ Exports work

COMMUNICATION

[x] ✅ Announcements work

[~] ⬜ Notifications work

SETTINGS

[x] ✅ Organisation settings work

[x] ✅ Permissions work

[x] ✅ Roles work

[x] ✅ Policies work

[x] ✅ Notification settings work

[x] ✅ Integrations work

[x] ✅ Billing screen works

[x] ✅ Audit screen works

PROFILE

[x] ✅ Personal information works

[x] ✅ Preferences work

[x] ✅ Security controls work

[x] ✅ Sessions work

[x] ✅ Activity history works

PWA

[~] ⬜ Install prompt works

[~] ⬜ Offline state works

[~] ⬜ Update prompt works

[~] ⬜ Offline actions synchronise

RESPONSIVE

[x] ✅ Desktop works

[x] ✅ Tablet works

[x] ✅ Mobile works

ACCESSIBILITY

[~] ⬜ Keyboard navigation works

[x] ✅ Focus states are visible

[x] ✅ Forms are labelled

[~] ⬜ Colour contrast is sufficient

==================================================
30. FINAL DELIVERY
==================================================

Deliver:

1. A complete working RotaFlow application

2. A complete marketing website

3. A functional authenticated application

4. Working role-based navigation

5. Responsive desktop, tablet, and mobile layouts

6. Reusable design-system components

7. Persistent realistic demonstration data

8. Functional forms, tables, filters, modals, and workflows

9. A working PWA experience

10. Clean, maintainable, modular source code

Do not stop after creating the dashboard.

Build the complete end-to-end product experience.

Do not use placeholder pages.

Do not use non-functional buttons.

Do not create disconnected screen designs.

All screens must be connected through working navigation and meaningful application flows.

Prioritise a polished, coherent, operational workforce-management product that looks credible for healthcare, hospitality, retail, education, security, and multi-site organisations.

==================================================
31. RECOMMENDED IMPLEMENTATION INSTRUCTIONS
==================================================

Build RotaFlow using a modular, scalable, production-oriented architecture.

Do not place the entire application inside one component.

Do not create one large page file containing all business logic, UI, data, and state.

Separate:

• Application routing
• Layout components
• Design-system components
• Feature modules
• Data access
• Business logic
• Form validation
• Permissions
• Application state
• Mock data
• Utility functions
• Type definitions

Use a feature-first architecture.

Recommended technology stack:

Frontend:

• React
• TypeScript
• Vite

Styling:

• Tailwind CSS

Component primitives:

• shadcn/ui

Icons:

• Lucide React

Routing:

• React Router

Server and database:

• Supabase

Database:

• PostgreSQL

Authentication:

• Supabase Auth

File storage:

• Supabase Storage

Client data fetching and caching:

• TanStack Query

Client-side UI state:

• Zustand

Forms:

• React Hook Form

Validation:

• Zod

Tables:

• TanStack Table

Calendar and scheduling:

• FullCalendar or a modular scheduling component

Drag-and-drop:

• dnd-kit

Charts:

• Recharts

Date handling:

• date-fns

Notifications:

• Sonner or an equivalent accessible toast system

PWA:

• vite-plugin-pwa

Testing:

• Vitest
• React Testing Library
• Playwright

Do not introduce additional libraries unless they provide a clear implementation benefit.

==================================================
32. APPLICATION ARCHITECTURE
==================================================

Use the following project structure:

src/

app/

• App.tsx
• router.tsx
• providers.tsx
• queryClient.ts
• routes.ts

components/

• ui/
• layout/
• navigation/
• feedback/
• data-display/
• forms/

features/

• auth/
• onboarding/
• dashboard/
• rota/
• schedule/
• team/
• staff-profile/
• availability/
• leave/
• swaps/
• overtime/
• attendance/
• timesheets/
• reports/
• announcements/
• locations/
• settings/
• profile/
• notifications/
• search/

lib/

• supabase.ts
• permissions.ts
• dates.ts
• formatting.ts
• exports.ts
• validation.ts

hooks/

• useAuth.ts
• useOrganisation.ts
• usePermissions.ts
• useNotifications.ts
• useOfflineStatus.ts
• useSyncQueue.ts

stores/

• appStore.ts
• uiStore.ts
• rotaStore.ts

types/

• database.ts
• organisation.ts
• staff.ts
• rota.ts
• attendance.ts
• notifications.ts

data/

• seedData.ts
• demoData.ts

styles/

• globals.css
• tokens.css

tests/

• unit/
• integration/
• e2e/

Do not create duplicate versions of the same component.

Reuse components throughout the application.

Examples:

Use one:

• AppButton
• AppInput
• AppSelect
• AppModal
• AppDrawer
• AppTable
• StatusBadge
• PageHeader
• MetricCard
• EmptyState
• LoadingState
• ErrorState
• ConfirmDialog

Do not create separate button, table, badge, or modal implementations for every feature.

==================================================
33. DESIGN TOKEN IMPLEMENTATION
==================================================

Implement the RotaFlow design system as reusable design tokens.

Create semantic tokens for:

Colours:

• primary
• primary-hover
• primary-active
• primary-light
• background
• surface
• surface-muted
• border
• text-primary
• text-secondary
• text-muted
• success
• warning
• danger
• information

Spacing:

• space-1
• space-2
• space-3
• space-4
• space-5
• space-6
• space-8
• space-10
• space-12
• space-16

Border radius:

• radius-sm
• radius-md
• radius-lg
• radius-xl

Shadows:

• shadow-sm
• shadow-md
• shadow-lg

Typography:

• font-sans
• text-xs
• text-sm
• text-base
• text-lg
• text-xl
• text-2xl
• text-3xl
• text-display

Do not hard-code random colours or spacing values throughout components.

Use semantic design tokens.

==================================================
34. ROUTING IMPLEMENTATION
==================================================

Create the following route hierarchy.

Public routes:

/

Home

/features

Features

/solutions

Solutions

/pricing

Pricing

/resources

Resources

/about

About

/contact

Contact

/login

Sign in

/signup

Sign up

/forgot-password

Forgot password

/reset-password

Reset password

/auth/callback

Authentication callback

/invite/:token

Accept invitation

Authenticated routes:

/app

Application redirect

/app/dashboard

Dashboard

/app/rota

Rota Builder

/app/schedule

Schedule

/app/team

Team

/app/team/:staffId

Staff profile

/app/availability

Availability

/app/leave

Leave

/app/swaps

Shift swaps

/app/overtime

Overtime

/app/clock-in

Clock in and out

/app/timesheets

Timesheets

/app/reports

Reports

/app/announcements

Announcements

/app/locations

Locations

/app/locations/:locationId

Location detail

/app/notifications

Notification centre

/app/settings

Settings redirect

/app/settings/organisation

Organisation

/app/settings/permissions

Permissions

/app/settings/roles

Roles

/app/settings/policies

Policies

/app/settings/notifications

Notification settings

/app/settings/integrations

Integrations

/app/settings/billing

Billing

/app/settings/audit

Audit

/app/profile

Profile redirect

/app/profile/personal

Personal information

/app/profile/preferences

Preferences

/app/profile/security

Security

/app/profile/accounts

Connected accounts

/app/profile/sessions

Sessions

/app/profile/activity

Activity

Platform administration:

/admin

Platform dashboard

/admin/organisations

Tenant management

/admin/users

Platform users

/admin/billing

Platform billing

/admin/support

Support tools

/admin/audit

Platform audit

/admin/feature-flags

Feature flags

Create:

• Public route guard
• Authenticated route guard
• Organisation membership guard
• Role guard
• Platform administrator guard

Restricted routes must not rely only on hidden navigation.

Enforce permission checks at route level and action level.

==================================================
35. SUPABASE IMPLEMENTATION
==================================================

Use Supabase for:

• Authentication
• PostgreSQL database
• Row Level Security
• File storage
• Real-time updates where appropriate

Create the following core tables:

profiles

organisations

memberships

locations

departments

roles

permissions

role_permissions

staff_profiles

emergency_contacts

qualifications

documents

shift_types

shift_templates

rotas

shifts

availability

leave_requests

leave_balances

shift_swap_requests

overtime_requests

clock_events

timesheets

timesheet_entries

announcements

announcement_recipients

notifications

notification_preferences

audit_logs

integrations

api_keys

subscriptions

support_access_sessions

Create appropriate:

• Primary keys
• Foreign keys
• Unique constraints
• Check constraints
• Indexes
• Created timestamps
• Updated timestamps
• Soft-delete fields where required

Use UUID primary keys.

All organisation-owned records must include:

organisation_id

Use database constraints to prevent invalid relationships.

Add a unique rota constraint:

organisation_id

location_id

period_start

period_end

This must prevent duplicate rota records for the same organisation, location, and period.

==================================================
36. ROW LEVEL SECURITY
==================================================

Enable Row Level Security on all organisation data.

Security principles:

• Users can only access organisations where they have active membership.
• Staff can only view and edit their own personal records unless granted additional permission.
• Managers can access operational workforce information within their organisation.
• Owners can manage organisation-wide settings.
• Platform administrators can access platform-level administration.
• Users must not access data by changing IDs in the browser.
• Sensitive actions must be checked server-side.

Do not rely solely on frontend role checks.

Use RLS policies and server-side validation.

==================================================
37. AUTHENTICATION IMPLEMENTATION
==================================================

Support:

• Email and password
• Password reset
• Magic link
• Google authentication
• Microsoft authentication
• Invitation acceptance
• Email verification

Implement:

• Session restoration
• Session expiry handling
• Protected routes
• Secure sign-out
• Redirect to intended route after sign-in

After sign-in:

1. Restore the user session.

2. Load the user profile.

3. Load organisation memberships.

4. Determine the active organisation.

5. Load the user role and permissions.

6. Load organisation settings.

7. Redirect to the correct dashboard.

If the user has no organisation:

Redirect to onboarding.

If the user has multiple organisations:

Show the organisation switcher.

==================================================
38. DATA ACCESS PATTERN
==================================================

Use TanStack Query for server data.

Create feature-specific query hooks.

Examples:

useDashboardQuery

useStaffQuery

useStaffDetailQuery

useRotaQuery

useScheduleQuery

useAvailabilityQuery

useLeaveRequestsQuery

useShiftSwapsQuery

useClockEventsQuery

useTimesheetsQuery

useReportsQuery

useAnnouncementsQuery

useLocationsQuery

useOrganisationSettingsQuery

Use mutation hooks for:

createStaff

updateStaff

deactivateStaff

createRota

updateRota

publishRota

createShift

updateShift

deleteShift

submitAvailability

requestLeave

approveLeave

declineLeave

requestSwap

approveSwap

declineSwap

clockIn

startBreak

endBreak

clockOut

approveTimesheet

publishAnnouncement

updateOrganisation

Create optimistic updates only where safe.

For critical actions, use server confirmation.

Critical actions include:

• Publishing a rota
• Approving leave
• Approving a shift swap
• Clocking in
• Clocking out
• Approving timesheets
• Changing permissions
• Changing billing information
• Deleting records

==================================================
39. STATE MANAGEMENT
==================================================

Use Zustand only for client-side state.

Use TanStack Query for server state.

Do not duplicate server data inside Zustand.

Recommended Zustand stores:

uiStore:

• Sidebar state
• Mobile navigation state
• Active modal
• Active drawer
• Theme
• Display density

appStore:

• Active organisation
• User interface preferences
• Global application status

rotaStore:

• Local rota editing state
• Unsaved changes
• Selected shifts
• Drag state
• Rota filters

Do not store sensitive data in local storage.

==================================================
40. FORM IMPLEMENTATION
==================================================

Use:

React Hook Form

and

Zod

Every form must:

• Use a defined schema.
• Validate required fields.
• Validate email addresses.
• Validate date ranges.
• Validate time ranges.
• Prevent invalid submission.
• Display inline errors.
• Display a loading state.
• Prevent duplicate submission.
• Display success or error feedback.
• Reset or redirect appropriately after success.

Use reusable form components.

Required form components:

• TextField
• EmailField
• PasswordField
• PhoneField
• NumberField
• CurrencyField
• DateField
• TimeField
• DateRangeField
• SelectField
• MultiSelectField
• CheckboxField
• RadioGroupField
• SwitchField
• TextareaField
• FileUploadField

==================================================
41. ROTA BUILDER IMPLEMENTATION
==================================================

The rota builder is a critical feature.

Implement it as a feature module.

Required capabilities:

• Weekly rota grid
• Daily rota view
• Location selection
• Department selection
• Date navigation
• Shift assignment
• Shift editing
• Drag and drop
• Shift duplication
• Shift deletion
• Open shifts
• Shift templates
• Staff filtering
• Role filtering
• Coverage calculation
• Labour-hour calculation
• Estimated labour cost
• Draft saving
• Publishing
• Unpublishing

Create a validation engine.

Validate:

• Staff availability
• Approved leave
• Overlapping shifts
• Minimum rest periods
• Maximum working hours
• Required qualifications
• Location restrictions
• Department restrictions
• Contracted hours
• Shift capacity

Classify warnings:

Critical:

Cannot publish without resolution.

Warning:

Can publish after manager acknowledgement.

Information:

Informational only.

Show validation results in a dedicated validation panel.

Do not silently allow invalid assignments.

==================================================
42. CLOCK-IN IMPLEMENTATION
==================================================

Clock-in must use a reliable state model.

Attendance states:

NOT_STARTED

CLOCKED_IN

ON_BREAK

CLOCKED_OUT

OFFLINE_PENDING

Use a clock-event model.

Event types:

CLOCK_IN

BREAK_START

BREAK_END

CLOCK_OUT

MANUAL_ADJUSTMENT

Store:

• User
• Organisation
• Shift
• Event type
• Timestamp
• Location method
• GPS status
• QR status
• PIN status
• Device information
• Offline status

Clock-in flow:

1. Load current scheduled shift.

2. Check clock-in window.

3. Check location requirements.

4. Request location permission if required.

5. Validate attendance method.

6. Create clock-in event.

7. Update current attendance state.

8. Update current worked duration.

9. Update timesheet data.

10. Create notification or alert where required.

Clock-out flow:

1. Confirm clock-out.

2. Check for active break.

3. Calculate gross duration.

4. Calculate break duration.

5. Calculate net worked duration.

6. Create clock-out event.

7. Update timesheet.

8. Update weekly summary.

9. Create audit event.

10. Display confirmation.

Offline clock-in:

• Store event locally.
• Mark as pending.
• Display synchronisation status.
• Retry automatically.
• Prevent duplicate event creation.
• Reconcile with the server when online.

==================================================
43. NOTIFICATION IMPLEMENTATION
==================================================

Create a notification service.

Notification types:

• Rota published
• Shift changed
• Shift reminder
• Leave submitted
• Leave approved
• Leave declined
• Swap requested
• Swap accepted
• Swap declined
• Swap approved
• Attendance reminder
• Clock-in exception
• Announcement
• System notification

Notification properties:

• ID
• User
• Type
• Title
• Message
• Related entity
• Read status
• Created date
• Delivery channel

Support:

• In-app notifications
• Email-ready notification structure
• Push-ready notification structure
• Notification preferences

==================================================
44. AUDIT LOGGING
==================================================

Create audit records for important actions.

Record:

• Actor
• Organisation
• Action
• Entity type
• Entity ID
• Previous value
• New value
• Timestamp
• IP address where available
• Device information where appropriate

Audit important actions:

• Staff created
• Staff updated
• Staff deactivated
• Rota created
• Rota updated
• Rota published
• Shift assigned
• Shift changed
• Leave approved
• Leave declined
• Swap approved
• Timesheet approved
• Clock event recorded
• Permissions changed
• Organisation settings changed
• Billing settings changed
• Support access enabled

Do not expose sensitive information in standard audit views.

==================================================
45. ERROR HANDLING
==================================================

Implement:

• Global error boundary
• Route-level error boundaries
• Query error states
• Form error states
• Offline error states
• Permission errors
• Not-found screen

Error states must provide:

• Clear explanation
• Relevant recovery action
• Retry button where appropriate
• Back button
• Support reference ID for unexpected errors

Do not expose raw database errors to users.

Log technical errors safely.

==================================================
46. LOADING AND EMPTY STATES
==================================================

Every major page must have:

Loading state

Use:

• Skeleton cards
• Skeleton tables
• Skeleton charts
• Skeleton schedule grid

Empty state

Include:

• Relevant icon
• Clear title
• Brief explanation
• Primary action

Examples:

No staff:

Add your first staff member.

No rota:

Create a rota for this week.

No leave requests:

There are no leave requests requiring review.

No notifications:

You are all caught up.

Do not use blank white areas when data is unavailable.

==================================================
47. EXPORT IMPLEMENTATION
==================================================

Support:

CSV

XLSX

PDF

ICS

Exports must use current filters.

Include:

• Report title
• Organisation name
• Selected date range
• Applied filters
• Export date

Show:

Preparing export

Export ready

Download complete

For large exports:

Use an asynchronous export job model.

==================================================
48. RESPONSIVE IMPLEMENTATION
==================================================

Desktop:

• Persistent sidebar
• Multi-column dashboard
• Full data tables
• Large rota grid

Tablet:

• Collapsible sidebar
• Reduced columns
• Responsive filters

Mobile:

• Bottom navigation
• Slide-out menu
• Stacked cards
• Mobile schedule
• Mobile clock-in
• Filter drawers
• Full-width actions

Do not shrink desktop tables until unreadable.

Convert complex data into mobile-friendly cards where required.

==================================================
49. PERFORMANCE REQUIREMENTS
==================================================

Implement:

• Route-based code splitting
• Lazy-loaded feature modules
• Image optimisation
• Virtualised large tables where required
• Virtualised rota rows where required
• Query caching
• Pagination
• Debounced search
• Avoid unnecessary re-renders
• Memoise expensive calculations

Performance targets:

• Fast initial application shell
• Responsive interactions
• No unnecessary full-page reloads
• No blocking operations during rota editing

==================================================
50. TESTING REQUIREMENTS
==================================================

Create tests for critical workflows.

Authentication:

• Sign in
• Sign out
• Password reset
• Protected route

Rota:

• Create rota
• Add shift
• Assign staff
• Detect conflict
• Save draft
• Publish rota

Staff:

• Add staff
• Edit staff
• Deactivate staff

Leave:

• Submit leave
• Approve leave
• Decline leave

Swaps:

• Request swap
• Approve swap
• Update rota

Attendance:

• Clock in
• Start break
• End break
• Clock out
• Offline queue

Permissions:

• Staff restriction
• Manager access
• Owner access
• Platform administrator access

Use:

• Unit tests
• Integration tests
• End-to-end tests

==================================================
51. IMPLEMENTATION ORDER
==================================================

Build in the following order.

Phase 1:

Foundation

• Project setup
• Design tokens
• Component library
• Routing
• Application shell
• Authentication
• Organisation context
• Permissions
• Seed data

Phase 2:

Core workforce setup

• Onboarding
• Organisation settings
• Locations
• Departments
• Team directory
• Staff profiles
• Invitations

Phase 3:

Core rota workflow

• Shift types
• Shift templates
• Rota builder
• Shift assignment
• Validation
• Drafts
• Publishing

Phase 4:

Staff experience

• Personal schedule
• Availability
• Leave
• Shift swaps
• Overtime

Phase 5:

Attendance

• Clock in
• Breaks
• Clock out
• Attendance history
• Timesheets

Phase 6:

Operations

• Dashboard
• Announcements
• Notifications
• Reports
• Exports

Phase 7:

Administration

• Roles
• Permissions
• Policies
• Integrations
• Billing
• Audit

Phase 8:

PWA

• Install
• Offline support
• Sync queue
• Update prompt

Phase 9:

Quality assurance

• Responsive review
• Accessibility review
• Security review
• Performance review
• Testing
• Final visual consistency review

==================================================
52. FINAL IMPLEMENTATION RULES
==================================================

Do not:

• Build only the dashboard.
• Use static screenshots as application pages.
• Leave buttons without actions.
• Create placeholder routes.
• Duplicate business logic.
• Store server data in multiple places.
• Rely only on frontend permission checks.
• Expose sensitive database errors.
• Use untyped application data.
• Use random hard-coded values across components.
• Build large monolithic components.
• Ignore mobile layouts.
• Ignore loading, error, or empty states.
• Use fake functionality without clearly structured state.

Do:

• Build reusable components.
• Use TypeScript throughout.
• Use typed data models.
• Use schema validation.
• Use secure database policies.
• Use feature-based modules.
• Keep server state and client state separate.
• Connect related workflows.
• Persist user actions.
• Update related screens after mutations.
• Maintain a consistent RotaFlow design system.
• Test critical operational workflows.
• Build the product in phases.
• Verify every route and action before completion.

The final result must be a functional, scalable, secure, responsive workforce scheduling platform rather than a visual prototype.