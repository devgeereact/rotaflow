const EARTH_RADIUS_M = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in metres (haversine). */
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export interface GeofenceCheck {
  withinFence: boolean;
  distanceM: number;
}

/**
 * Is a position within a location's geofence?
 *
 * Returns `withinFence: true` when the location has no coordinates set. Most
 * locations won't, since `address` is optional at onboarding (StepAbout) and
 * lat/long aren't collected there at all yet. Treating "no geofence
 * configured" as a hard block would make GPS clock-in unusable for every org
 * that hasn't separately set location coordinates; this makes the check
 * advisory until that data exists, not a false rejection.
 */
export function checkGeofence(
  position: { latitude: number; longitude: number },
  location: {
    latitude: number | null;
    longitude: number | null;
    geofence_radius_m: number;
  },
): GeofenceCheck {
  if (location.latitude === null || location.longitude === null) {
    return { withinFence: true, distanceM: 0 };
  }
  const distanceM = distanceMetres(position, {
    latitude: location.latitude,
    longitude: location.longitude,
  });
  return { withinFence: distanceM <= location.geofence_radius_m, distanceM };
}
