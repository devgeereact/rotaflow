/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMyDataRequests = vi.hoisted(() => vi.fn());
const requestMyData = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn());
const showSuccess = vi.hoisted(() => vi.fn());
const showError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/sentry', () => ({ reportError: vi.fn() }));
vi.mock('@/services/gdprRequestService', () => ({ listMyDataRequests, requestMyData }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showError, showSuccess }) }));
vi.mock('@/hooks/useOrg', () => ({ useOrg: () => ({ orgId: 'org-1' }) }));

import { YourDataPage } from '@/pages/app/account/YourDataPage';

describe('YourDataPage', () => {
  beforeEach(() => {
    listMyDataRequests.mockReset().mockResolvedValue([]);
    requestMyData.mockReset();
    confirm.mockReset().mockResolvedValue(true);
    showSuccess.mockReset();
    showError.mockReset();
  });

  afterEach(() => cleanup());

  it('files a request for the active organisation and gives the due date', async () => {
    requestMyData.mockResolvedValue({
      id: 'r1',
      dueOn: '2027-03-03',
      alreadyOpen: false,
    });
    render(<YourDataPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Request a copy' }));

    await waitFor(() => expect(requestMyData).toHaveBeenCalledWith('access', 'org-1'));
    expect(showSuccess).toHaveBeenCalledWith(
      'Request received. We will answer by 3 March 2027.',
    );
    // The list is re-read so the new request appears.
    await waitFor(() => expect(listMyDataRequests).toHaveBeenCalledTimes(2));
  });

  it('says so when the same request is already open', async () => {
    requestMyData.mockResolvedValue({ id: 'r1', dueOn: '2027-03-03', alreadyOpen: true });
    render(<YourDataPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Request a copy' }));

    await waitFor(() =>
      expect(showSuccess).toHaveBeenCalledWith(
        'You already asked for this. We will answer by 3 March 2027.',
      ),
    );
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    confirm.mockResolvedValue(false);
    render(<YourDataPage />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Ask to close my account' }),
    );

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0]![0]).toMatchObject({ tone: 'danger' });
    expect(requestMyData).not.toHaveBeenCalled();
  });

  it('lists the person’s own requests with the deadline that applies', async () => {
    listMyDataRequests.mockResolvedValue([
      {
        id: 'r1',
        kind: 'erasure',
        status: 'in_progress',
        receivedOn: '2027-01-31',
        dueOn: '2027-02-28',
        extendedTo: '2027-04-28',
        closedAt: null,
      },
    ]);
    render(<YourDataPage />);

    expect(await screen.findByText('Close account and erase data')).toBeTruthy();
    expect(
      screen.getByText('Asked 31 January 2027 · answer due by 28 April 2027'),
    ).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('points to email when the request cannot be sent', async () => {
    requestMyData.mockRejectedValue(new Error('network'));
    render(<YourDataPage />);

    await userEvent.click(screen.getByRole('button', { name: 'Ask for a correction' }));

    await waitFor(() => expect(showError).toHaveBeenCalled());
    expect(showError.mock.calls[0]![0]).toContain('support@rotaflow.space');
  });
});
