import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import {
  createDepartment,
  deleteDepartment,
  listDepartments,
  updateDepartment,
} from '@/services/locationService';
import { reportError } from '@/lib/sentry';
import { Input } from '@/components/ui/Input';
import { LoadingState } from '@/components/ui/LoadingState';
import type { Department } from '@/types';

interface DepartmentManagerProps {
  orgId: string;
  locationId: string;
}

/** Inline department CRUD nested under a location's detail panel. */
export function DepartmentManager({
  orgId,
  locationId,
}: DepartmentManagerProps): JSX.Element {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await listDepartments(orgId, locationId);
      setDepartments(rows);
    } catch (err) {
      reportError(err, { area: 'departments:load' });
    } finally {
      setLoading(false);
    }
  }, [orgId, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (): Promise<void> => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const dept = await createDepartment({
        org_id: orgId,
        location_id: locationId,
        name: newName.trim(),
      });
      setDepartments((prev) =>
        [...prev, dept].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewName('');
    } catch (err) {
      reportError(err, { area: 'departments:create' });
      setError('Could not add department.');
    }
  };

  const startEdit = (dept: Department): void => {
    setEditingId(dept.id);
    setEditValue(dept.name);
  };

  const saveEdit = async (id: string): Promise<void> => {
    if (!editValue.trim()) return;
    setError(null);
    try {
      const updated = await updateDepartment(id, { name: editValue.trim() });
      setDepartments((prev) => prev.map((d) => (d.id === id ? updated : d)));
      setEditingId(null);
    } catch (err) {
      reportError(err, { area: 'departments:update' });
      setError('Could not save department.');
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    setError(null);
    try {
      await deleteDepartment(id);
      setDepartments((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      reportError(err, { area: 'departments:delete' });
      setError('Could not remove that department — it may still have staff assigned.');
    }
  };

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-content dark:text-content-dark">
        Departments
      </h3>
      {loading ? (
        <LoadingState
          variant="text"
          rows={2}
          label="Loading departments…"
          className="mb-3"
        />
      ) : (
        <ul className="mb-3 space-y-1">
          {departments.map((dept) => (
            <li
              key={dept.id}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark"
            >
              {editingId === dept.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    className="py-1.5"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => void saveEdit(dept.id)}
                    aria-label="Save"
                    className="rounded text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    aria-label="Cancel"
                    className="rounded text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-sm text-content dark:text-content-dark">
                    {dept.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(dept)}
                      aria-label={`Edit ${dept.name}`}
                      className="rounded text-content-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark"
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(dept.id)}
                      aria-label={`Delete ${dept.name}`}
                      className="rounded text-content-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-content-muted-dark"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
          {departments.length === 0 && (
            <li className="text-sm text-content-muted dark:text-content-muted-dark">
              No departments yet.
            </li>
          )}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          className="py-1.5"
          placeholder="New department"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleAdd();
          }}
        />
        <button
          type="button"
          onClick={() => void handleAdd()}
          aria-label="Add department"
          disabled={!newName.trim()}
          className="rounded-lg bg-primary p-2 text-primary-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:opacity-50"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
