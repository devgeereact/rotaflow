import type { TabItem } from '@/components/ui/Tabs';

/**
 * The three request screens, in the order the phone switch shows them.
 *
 * Shared by `RequestsLayout` (the switch drawn above each screen) and
 * `MobileTabBar` (which keeps "Requests" highlighted on all three), so the two
 * cannot disagree about what counts as a request.
 */
export const REQUEST_SECTIONS: readonly TabItem[] = [
  { to: '/app/leave', label: 'Leave' },
  { to: '/app/swaps', label: 'Swaps' },
  { to: '/app/overtime', label: 'Overtime' },
] as const;

/** Whether a pathname is one of the request screens. */
export function isRequestPath(pathname: string): boolean {
  return REQUEST_SECTIONS.some(
    (section) => pathname === section.to || pathname.startsWith(`${section.to}/`),
  );
}
