import { useContext } from 'react';
import { ConfirmContext, type ConfirmContextValue } from '@/context/ConfirmContext';

/** Promise-based confirmation dialog. Must be used inside `ConfirmProvider`. */
export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
