import {
  Activity,
  Accessibility,
  ChefHat,
  HeartPulse,
  Settings,
  ShieldCheck,
  Users,
  Utensils,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DepartmentIcon } from '@/lib/locationsDirectory';

/**
 * Department-row marks, matched to the glyphs drawn on
 * design/Location-department.png.
 *
 * `housekeeping` is cutlery because that is what the reference draws for
 * "Cleaning and linen services". Almost certainly a slip in the mockup, since
 * `catering` beside it is a chef's hat. Kept faithful to the reference here;
 * flag it before this ships to a real org.
 */
export const DEPARTMENT_ICONS: Record<DepartmentIcon, LucideIcon> = {
  clinical: HeartPulse,
  care: Users,
  night: Activity,
  therapy: Accessibility,
  housekeeping: Utensils,
  catering: ChefHat,
  maintenance: Settings,
  admin: ShieldCheck,
};
