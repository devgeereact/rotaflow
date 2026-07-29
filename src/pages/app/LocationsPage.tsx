import { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus, Pencil } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import {
  createLocation,
  listLocations,
  updateLocation,
} from '@/services/locationService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  LocationFormModal,
  type LocationFormValues,
} from '@/components/locations/LocationFormModal';
import { DepartmentManager } from '@/components/locations/DepartmentManager';
import type { Location, LocationInsert } from '@/types';

function toInsert(orgId: string, values: LocationFormValues): LocationInsert {
  return {
    org_id: orgId,
    name: values.name.trim(),
    address: values.address.trim() || null,
    latitude: values.latitude ? Number(values.latitude) : null,
    longitude: values.longitude ? Number(values.longitude) : null,
    timezone: values.timezone,
    geofence_radius_m: values.geofenceRadiusM ? Number(values.geofenceRadiusM) : 150,
  };
}

export function LocationsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canManageStaff } = usePermissions();

  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    try {
      const rows = await listLocations(orgId);
      setLocations(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (err) {
      reportError(err, { area: 'locations:load' });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (values: LocationFormValues): Promise<void> => {
    if (!orgId) return;
    if (editingLocation) {
      const updated = await updateLocation(editingLocation.id, toInsert(orgId, values));
      setLocations((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    } else {
      const created = await createLocation(toInsert(orgId, values));
      setLocations((prev) => [...prev, created]);
      setSelectedId(created.id);
    }
  };

  const openCreate = (): void => {
    setEditingLocation(null);
    setModalOpen(true);
  };

  const openEdit = (location: Location): void => {
    setEditingLocation(location);
    setModalOpen(true);
  };

  const selected = locations.find((l) => l.id === selectedId) ?? null;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-display text-3xl text-content dark:text-content-dark">
          Locations
        </h1>
        {canManageStaff && (
          <Button size="sm" onClick={openCreate}>
            <Plus size={16} aria-hidden="true" className="mr-1.5" />
            Add location
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      ) : locations.length === 0 ? (
        <Card className="text-center">
          <MapPin className="mx-auto mb-3 text-content-muted dark:text-content-muted-dark" size={28} />
          <p className="mb-4 text-content-muted dark:text-content-muted-dark">
            No locations yet — add your first site to start building rotas.
          </p>
          {canManageStaff && <Button onClick={openCreate}>Add location</Button>}
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            {locations.map((location) => (
              <button
                key={location.id}
                type="button"
                onClick={() => setSelectedId(location.id)}
                className={cn(
                  'w-full rounded-2xl border p-4 text-left transition-colors',
                  selectedId === location.id
                    ? 'border-primary bg-surface dark:bg-surface-dark'
                    : 'border-surface-border bg-surface hover:bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-dark dark:hover:bg-surface-subtle-dark',
                )}
              >
                <p className="font-medium text-content dark:text-content-dark">{location.name}</p>
                {location.address && (
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {location.address}
                  </p>
                )}
                <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
                  {location.timezone}
                </p>
              </button>
            ))}
          </div>

          {selected && (
            <Card>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-content dark:text-content-dark">
                    {selected.name}
                  </h2>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {selected.address || 'No address set'}
                  </p>
                </div>
                {canManageStaff && (
                  <button
                    type="button"
                    onClick={() => openEdit(selected)}
                    aria-label="Edit location"
                    className="text-content-muted hover:text-primary dark:text-content-muted-dark"
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </div>

              {orgId && <DepartmentManager orgId={orgId} locationId={selected.id} />}
            </Card>
          )}
        </div>
      )}

      <LocationFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        initial={editingLocation}
      />
    </div>
  );
}
