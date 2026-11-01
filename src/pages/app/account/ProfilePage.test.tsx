/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listEmergencyContacts = vi.hoisted(() => vi.fn());
const getMyStaffProfile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1', role: 'staff' }) }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'amara@example.com' } }),
}));
vi.mock('@/services/profileService', () => ({
  getProfile: vi
    .fn()
    .mockResolvedValue({ full_name: 'Amara Okafor', email: 'amara@example.com' }),
  updateProfile: vi.fn(),
}));
vi.mock('@/services/staffService', () => ({
  getMyStaffProfile,
  updateStaffProfile: vi.fn(),
}));
vi.mock('@/services/staffPhotoService', () => ({
  removeStaffPhoto: vi.fn(),
  uploadStaffPhoto: vi.fn(),
}));
vi.mock('@/services/orgService', () => ({
  getOrganisation: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/auditService', () => ({
  listMyAuditLogs: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/emergencyContactService', () => ({
  listEmergencyContacts,
  createEmergencyContact: vi.fn(),
  deleteEmergencyContact: vi.fn(),
}));

import { ProfilePage } from '@/pages/app/account/ProfilePage';

const STAFF = {
  id: 'staff-1',
  org_id: 'org-1',
  first_name: 'Amara',
  last_name: 'Okafor',
  phone: '07700 900123',
  photo_url: null,
};

function renderPage(): void {
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

/**
 * Design gap F33: a person could not manage their own emergency contacts,
 * although the API has always allowed it. The section sits in the contact
 * card's second column and opens the same window a manager uses.
 */
describe('ProfilePage emergency contacts', () => {
  beforeEach(() => {
    getMyStaffProfile.mockReset().mockResolvedValue(STAFF);
    listEmergencyContacts.mockReset();
  });

  afterEach(() => cleanup());

  it('says how many contacts are saved and opens the editor', async () => {
    listEmergencyContacts.mockResolvedValue([
      {
        id: 'c1',
        name: 'Chidi Okafor',
        phone: '07700 900456',
        staff_profile_id: 'staff-1',
      },
    ]);
    renderPage();

    expect(
      await screen.findByText('1 saved. Only you and your managers can see them.'),
    ).toBeTruthy();
    expect(listEmergencyContacts).toHaveBeenCalledWith('org-1', 'staff-1');

    await userEvent.click(
      screen.getByRole('button', { name: 'Manage emergency contacts' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: /Emergency contacts, Amara Okafor/ }),
      ).toBeTruthy(),
    );
  });

  it('invites the first contact when none is saved', async () => {
    listEmergencyContacts.mockResolvedValue([]);
    renderPage();

    expect(
      await screen.findByText('None saved yet. Add someone your employer can call.'),
    ).toBeTruthy();
  });

  it('points to Security for changing the sign-in email', async () => {
    listEmergencyContacts.mockResolvedValue([]);
    renderPage();

    const link = await screen.findByRole('link', { name: 'Security' });
    expect(link.getAttribute('href')).toBe('/app/account/security');
  });
});
