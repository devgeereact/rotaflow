/**
 * Design-loop fixtures for the Staff Profile preview
 * (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.staffDetail`).
 *
 * `/app/team/:staffId` needs a real Supabase session and a seeded staff
 * record, so `/staff-preview/:staffId` renders the same components against
 * this fixed row. Nothing here is used by the authenticated routes.
 */

import type { StaffProfileData } from '@/lib/staffProfile';

export const DEMO_PROFILE: StaffProfileData = {
  id: 'sarah-johnson',
  firstName: 'Sarah',
  lastName: 'Johnson',
  photoUrl: null,
  role: 'Senior Nurse',
  department: 'Nursing',
  location: 'Sunshine Care Home',
  active: true,
  personal: {
    email: 'sarah.johnson@sunnyvale.co.uk',
    phone: '07712 345 678',
    joinedLabel: 'Joined 12 March 2022',
    birthLabel: '',
    gender: '',
    location: 'Sunshine Care Home',
  },
  work: [
    { label: 'Employee ID', value: 'RN12345' },
    {
      label: 'Role',
      value: 'Senior Nurse',
      badge: { code: 'RN', tone: 'violet' },
    },
    { label: 'Department', value: 'Nursing' },
    { label: 'Location', value: 'Sunshine Care Home' },
    { label: 'Employment Type', value: 'Full-time' },
    { label: 'Contracted Hours', value: '37.5 hours / week' },
  ],
  metrics: [
    { label: 'Shifts This Month', value: '16', hint: '128.00 hours' },
    { label: 'Hours This Month', value: '128.00', hint: '85% of contracted' },
    { label: 'Upcoming Shifts', value: '4', hint: 'Next: Today 07:00' },
    { label: 'Leave Allowance', value: '28', hint: 'days per year' },
  ],
  upcoming: [
    {
      id: 'shift-27',
      dateLabel: 'Today, 27 May',
      timeLabel: '07:00-15:00',
      typeName: 'Morning Shift',
      typeTone: 'morning',
      locationName: 'Sunshine Care Home',
      areaName: 'Nursing Floor 1',
      confirmed: true,
    },
    {
      id: 'shift-29',
      dateLabel: 'Thu, 29 May',
      timeLabel: '07:00-15:00',
      typeName: 'Morning Shift',
      typeTone: 'morning',
      locationName: 'Sunshine Care Home',
      areaName: 'Nursing Floor 1',
      confirmed: true,
    },
    {
      id: 'shift-01',
      dateLabel: 'Sun, 1 June',
      timeLabel: '15:00-23:00',
      typeName: 'Evening Shift',
      typeTone: 'evening',
      locationName: 'Sunshine Care Home',
      areaName: 'Nursing Floor 2',
      confirmed: true,
    },
  ],
  summaryMonth: 'May 2025',
  summary: [
    { label: 'Total Shifts', value: '16', tone: 'total' },
    { label: 'Morning', value: '10', tone: 'morning' },
    { label: 'Evening', value: '4', tone: 'evening' },
    { label: 'Night', value: '2', tone: 'night' },
    { label: 'Hours Worked', value: '128.00', tone: null },
  ],
  summaryHint: '85% of contracted',
  activity: [],
  skills: [
    { name: 'Nursing', level: null },
    { name: 'Medication Administration', level: null },
    { name: 'Dementia Care', level: null },
    { name: 'Wound Care', level: null },
    { name: 'Moving & Handling', level: null },
    { name: 'Safeguarding', level: null },
  ],
  documents: [
    {
      id: 'pdoc-nmc',
      name: 'NMC Pin Certificate',
      expiresLabel: 'Expires 31 Dec 2025',
      status: 'valid',
    },
    {
      id: 'pdoc-dbs',
      name: 'DBS Certificate',
      expiresLabel: 'Expires 4 Mar 2026',
      status: 'valid',
    },
    {
      id: 'pdoc-flu',
      name: 'Flu Vaccination',
      expiresLabel: 'Expires 15 Nov 2025',
      status: 'expiring',
    },
  ],
  emergencyContacts: [
    { id: 'ec-1', name: 'Ruth Osei', relationship: 'Sister', phone: '07700 900412' },
    { id: 'ec-2', name: 'Daniel Osei', relationship: 'Partner', phone: '07700 900188' },
  ],
  leave: [
    {
      id: 'l-1',
      type: 'annual',
      dateLabel: '18-22 August 2026',
      days: 5,
      status: 'approved',
    },
    {
      id: 'l-2',
      type: 'sick',
      dateLabel: '3 March 2026',
      days: 1,
      status: 'approved',
    },
  ],
};
