export interface LatLng { lat: number; lng: number }

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Straight-line distance understates real road distance in a dense city; these are
// deliberately conservative planning numbers, not routing results (the driver apps
// compute the real route). They are used for ranking and for the ETA shown to families.
const ROAD_FACTOR = 1.4;
const AVG_KMH = 30;
export const etaMinutes = (straightKm: number): number => Math.max(1, Math.round(((straightKm * ROAD_FACTOR) / AVG_KMH) * 60));
