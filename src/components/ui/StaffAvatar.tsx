import { cn } from '@/lib/utils';

interface StaffAvatarProps {
  firstName: string;
  lastName: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

const SIZES: Record<NonNullable<StaffAvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-[0.65rem]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-14 w-14 text-lg',
  '2xl': 'h-16 w-16 text-xl',
};

/** Staff photo, falling back to initials on a neutral tint, never a broken image icon. */
export function StaffAvatar({
  firstName,
  lastName,
  photoUrl,
  size = 'md',
  className,
}: StaffAvatarProps): JSX.Element {
  const initials = `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', SIZES[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary-ink dark:text-primary-ink-dark',
        SIZES[size],
        className,
      )}
    >
      {initials}
    </span>
  );
}
