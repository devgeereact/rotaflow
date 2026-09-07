import { describe, expect, it } from 'vitest';
import { summariseInviteDelivery } from '@/lib/inviteDelivery';

/**
 * RF-10 — "Invitations sent" must not appear after a send that failed.
 *
 * The audit reproduced this in Chromium: force `send-invite` to return HTTP
 * 503 and `sent: false`, and onboarding still showed the green toast. The
 * invitation itself was real, so nothing was broken in a way anyone could
 * see — staff simply never heard anything, and the owner had no reason to
 * chase it.
 *
 * The failing assertion in the audit's diagnostic asserted the BAD toast, to
 * prove the defect. Inverted here: these assert the correct message.
 */
describe('summariseInviteDelivery', () => {
  it('claims a send only when the mail endpoint accepted every one', () => {
    const summary = summariseInviteDelivery([{}, {}]);
    expect(summary).toEqual({
      tone: 'success',
      message: 'Invitations sent. Each link is shown below as a fallback.',
    });
  });

  it('never says "sent" when nothing was sent', () => {
    const summary = summariseInviteDelivery([{ deliveryError: 'SMTP refused' }]);
    expect(summary.tone).toBe('error');
    expect(summary.message).not.toContain('Invitations sent');
    expect(summary.message).toContain('could not be sent');
    expect(summary.message).toContain('created');
    // The link is the only recovery, so the message has to point at it.
    expect(summary.message).toContain('link');
  });

  it('counts a mixed batch truthfully rather than rounding to success', () => {
    const summary = summariseInviteDelivery([
      {},
      { deliveryError: 'no mailbox configured' },
      {},
    ]);
    expect(summary.tone).toBe('error');
    expect(summary.message).toContain('1 of 3');
  });

  it('separates "not created" from "created but not emailed"', () => {
    const summary = summariseInviteDelivery([
      { error: 'duplicate' },
      { deliveryError: 'SMTP refused' },
    ]);
    expect(summary.message).toContain('1 invitation could not be created');
    expect(summary.message).toContain('1 more was created but not emailed');
  });

  it('reports a whole failed batch in the plural', () => {
    const summary = summariseInviteDelivery([
      { deliveryError: 'x' },
      { deliveryError: 'y' },
    ]);
    expect(summary.message).toContain('no emails could be sent');
  });

  it('treats an empty batch as nothing to report rather than a failure', () => {
    expect(summariseInviteDelivery([]).tone).toBe('success');
  });
});
