import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import type { ShiftType } from '@/types';

function PaletteToken({ type }: { type: ShiftType }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette:${type.id}`,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className={cn(
        'flex cursor-grab items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white shadow-sm active:cursor-grabbing',
        paletteTokenForColour(type.colour),
        isDragging && 'opacity-40',
      )}
      title={`Drag onto the grid to schedule ${type.name}`}
    >
      {type.name}
    </button>
  );
}

interface ShiftTypePaletteProps {
  shiftTypes: ShiftType[];
  onManage: () => void;
}

/** Drag source: shift-type tokens the manager drags onto grid cells to create shifts. */
export function ShiftTypePalette({
  shiftTypes,
  onManage,
}: ShiftTypePaletteProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {shiftTypes.map((type) => (
        <PaletteToken key={type.id} type={type} />
      ))}
      <button
        type="button"
        onClick={onManage}
        aria-label="Manage shift types"
        className="rounded-full border border-surface-border p-1.5 text-content-muted hover:text-primary dark:border-surface-border-dark dark:text-content-muted-dark"
      >
        <Settings2 size={14} />
      </button>
    </div>
  );
}
