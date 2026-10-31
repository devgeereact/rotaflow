import type { OpenShift } from '@/services/openShiftService';

/**
 * Why the reader cannot take this shift, as one sentence, or null when nothing in their own
 * eligibility stops them. A clash the card already shows as "Clashes with your rota"
 * (`clashesWithMine`) is left to that badge, so a shift that only clashes reads exactly as before.
 */
export function ownBlockReason(shift: OpenShift): string | null {
  const own = shift.myEligibility;
  if (!own || own.eligible) return null;
  const reasons = own.reasons.filter(
    (r) => !(shift.clashesWithMine && r.code === 'overlap'),
  );
  return reasons.length > 0 ? reasons.map((r) => r.message).join('; ') : null;
}
