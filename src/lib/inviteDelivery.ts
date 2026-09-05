/**
 * What to tell someone after a batch of invitations was created.
 *
 * Pure, and in `lib` rather than inside `OnboardingPage`, for the reason
 * RF-10 existed at all: the old code decided this inline, in a callback, with
 * one boolean, and the wrong sentence was invisible to every gate the project
 * runs. A rendered toast is not checked by anything; a function is.
 *
 * The distinction it exists to keep is between three genuinely different
 * outcomes that used to share one green message:
 *
 *  - the invitation was not created, so there is nothing to send;
 *  - the invitation was created but the email did not go, so the durable link
 *    on screen is the only way the person will hear about it;
 *  - the invitation was created and the mail endpoint accepted it.
 *
 * The third is still only *acceptance*, not delivery to a mailbox. The wording
 * says "sent", which is what is actually known — a bounce an hour later is
 * outside anything this screen can observe.
 */
export interface InviteDeliveryOutcome {
  /** No invitation exists. */
  error?: string;
  /** An invitation exists, but the email failed. */
  deliveryError?: string;
}

export interface InviteDeliverySummary {
  tone: 'success' | 'error';
  message: string;
}

export function summariseInviteDelivery(
  results: readonly InviteDeliveryOutcome[],
): InviteDeliverySummary {
  const failed = results.filter((r) => r.error).length;
  const undelivered = results.filter((r) => !r.error && r.deliveryError).length;

  if (failed > 0) {
    return {
      tone: 'error',
      message:
        `${failed} invitation${failed === 1 ? '' : 's'} could not be created.` +
        (undelivered > 0
          ? ` ${undelivered} more ${undelivered === 1 ? 'was' : 'were'} created but not emailed.`
          : ''),
    };
  }

  if (undelivered > 0 && undelivered === results.length) {
    return {
      tone: 'error',
      message:
        results.length === 1
          ? 'The invitation was created but the email could not be sent. Copy the link below and send it yourself.'
          : 'The invitations were created but no emails could be sent. Copy the links below and send them yourself.',
    };
  }

  if (undelivered > 0) {
    return {
      tone: 'error',
      message: `${undelivered} of ${results.length} invitations could not be emailed. Their links are below — copy and send those yourself.`,
    };
  }

  return {
    tone: 'success',
    message: 'Invitations sent. Each link is shown below as a fallback.',
  };
}
