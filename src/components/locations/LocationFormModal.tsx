import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Label } from '@/components/ui/Label';
import type { Location } from '@/types';

const TIMEZONE_OPTIONS = [
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Australia/Sydney',
];

export interface LocationFormValues {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  timezone: string;
  geofenceRadiusM: string;
}

interface LocationFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: LocationFormValues) => Promise<void>;
  initial?: Location | null;
}

function toFormValues(location?: Location | null): LocationFormValues {
  return {
    name: location?.name ?? '',
    address: location?.address ?? '',
    latitude: location?.latitude?.toString() ?? '',
    longitude: location?.longitude?.toString() ?? '',
    timezone: location?.timezone ?? 'Europe/London',
    geofenceRadiusM: location?.geofence_radius_m?.toString() ?? '150',
  };
}

export function LocationFormModal({
  open,
  onClose,
  onSubmit,
  initial,
}: LocationFormModalProps): JSX.Element {
  const [values, setValues] = useState<LocationFormValues>(toFormValues(initial));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(toFormValues(initial));
      setError(null);
    }
  }, [open, initial]);

  const handleSubmit = async (): Promise<void> => {
    if (!values.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch {
      setError('Could not save this location. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Edit location' : 'Add location'}
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="loc-name">Name</Label>
          <Input
            id="loc-name"
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            placeholder="City Hospital"
          />
        </div>

        <div>
          <Label htmlFor="loc-address">Address</Label>
          <Input
            id="loc-address"
            value={values.address}
            onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))}
            placeholder="123 High Street, London"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="loc-lat">Latitude</Label>
            <Input
              id="loc-lat"
              type="number"
              step="any"
              value={values.latitude}
              onChange={(e) => setValues((v) => ({ ...v, latitude: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="loc-lng">Longitude</Label>
            <Input
              id="loc-lng"
              type="number"
              step="any"
              value={values.longitude}
              onChange={(e) => setValues((v) => ({ ...v, longitude: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="loc-tz">Timezone</Label>
            <Select
              id="loc-tz"
              value={values.timezone}
              onChange={(e) => setValues((v) => ({ ...v, timezone: e.target.value }))}
            >
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="loc-geofence">Geofence radius (m)</Label>
            <Input
              id="loc-geofence"
              type="number"
              min="0"
              value={values.geofenceRadiusM}
              onChange={(e) =>
                setValues((v) => ({ ...v, geofenceRadiusM: e.target.value }))
              }
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-content-muted dark:text-content-muted-dark">
          Used for GPS clock-in geofencing (a later feature). Captured now so it's ready
          when clock-in ships.
        </p>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button
          className="w-full"
          onClick={() => void handleSubmit()}
          disabled={submitting || !values.name.trim()}
        >
          {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add location'}
        </Button>
      </div>
    </Modal>
  );
}
