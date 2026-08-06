import { useCallback, useState } from 'react';

export interface GeoResult {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export type GeolocationStatus =
  'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';

export interface UseGeolocation {
  request: () => Promise<GeoResult | null>;
  status: GeolocationStatus;
}

/**
 * One-shot device position for GPS clock-in (docs/HOOKS.md §9).
 *
 * Resolves to null rather than throwing on denial/unavailability, a clock-in
 * screen must always fall back to manual entry, never hard-fail because a
 * browser permission was declined. `status` lets the UI show *why* GPS isn't
 * being used, without callers having to catch and interpret a raw
 * GeolocationPositionError.
 */
export function useGeolocation(): UseGeolocation {
  const [status, setStatus] = useState<GeolocationStatus>('idle');

  const request = useCallback(async (): Promise<GeoResult | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      return null;
    }

    setStatus('prompting');
    return new Promise<GeoResult | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setStatus('granted');
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          // PERMISSION_DENIED = 1; anything else (timeout, position
          // unavailable) is a device/environment issue, not a user decision.
          setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
  }, []);

  return { request, status };
}
