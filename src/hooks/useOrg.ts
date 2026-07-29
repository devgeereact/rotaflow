import { useContext } from 'react';
import { OrgContext, type OrgContextValue } from '@/context/OrgContext';

/**
 * Access the current organisation + membership role. Must be used within
 * <OrgProvider>. The provider owns the memberships query; this hook just reads it.
 */
export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (ctx === null) {
    throw new Error('useOrg must be used within an <OrgProvider>.');
  }
  return ctx;
}
