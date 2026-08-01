import { ArrowRightLeft } from 'lucide-react';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { SwapParty } from '@/lib/swapRows';

interface SwapPartiesProps {
  from: SwapParty;
  /** Null when the request is open to anyone rather than a named colleague. */
  to: SwapParty | null;
}

function Person({ party }: { party: SwapParty }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <StaffAvatar
        firstName={party.firstName}
        lastName={party.lastName}
        photoUrl={party.photoUrl}
        size="md"
      />
      <div className="min-w-0">
        <p className="truncate text-[0.7rem] font-semibold leading-4 text-content dark:text-content-dark">
          {party.firstName} {party.lastName}
        </p>
        {party.jobTitle && (
          <p className="truncate text-[0.68rem] leading-4 text-content-muted dark:text-content-muted-dark">
            {party.jobTitle}
          </p>
        )}
      </div>
    </div>
  );
}

/** Requester → colleague, with the swap glyph between (design/Swap-Request.png). */
export function SwapParties({ from, to }: SwapPartiesProps): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <Person party={from} />
      </div>
      <ArrowRightLeft
        size={15}
        aria-label="swapped with"
        className="shrink-0 text-content-muted dark:text-content-muted-dark"
      />
      <div className="min-w-0 flex-1">
        {to ? (
          <Person party={to} />
        ) : (
          <p className="truncate text-[0.7rem] font-semibold leading-4 text-content-muted dark:text-content-muted-dark">
            Open to anyone
          </p>
        )}
      </div>
    </div>
  );
}
