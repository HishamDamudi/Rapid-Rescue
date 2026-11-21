import { useState, useCallback } from 'react';

/**
 * Fetches a real driving route + turn-by-turn steps from the public OSRM
 * demo server (no API key needed). Falls back to a straight line if OSRM
 * is unreachable, so navigation never fully breaks.
 */
export function useDirections() {
  const [route, setRoute] = useState(null);   // [[lat,lng], ...]
  const [steps, setSteps] = useState([]);
  const [etaMin, setEtaMin] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchRoute = useCallback(async (from, to) => {
    setLoading(true);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
      const res = await fetch(url);
      const data = await res.json();
      const leg = data.routes?.[0];
      if (!leg) throw new Error('no route');
      const coords = leg.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      setRoute(coords);
      setEtaMin(Math.round(leg.duration / 60));
      setDistanceKm(+(leg.distance / 1000).toFixed(1));
      const stepList = (leg.legs?.[0]?.steps || []).map((s) => s.name ? `${s.maneuver.type} onto ${s.name}` : s.maneuver.type);
      setSteps(stepList.length ? stepList : ['Proceed to destination']);
    } catch {
      // fallback: straight line + haversine estimate
      setRoute([[from.lat, from.lng], [to.lat, to.lng]]);
      const R = 6371, dLat = (to.lat - from.lat) * Math.PI / 180, dLng = (to.lng - from.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      setDistanceKm(+km.toFixed(1));
      setEtaMin(Math.round(km / 0.5)); // ~30km/h
      setSteps(['Direct route (live routing unavailable) — head toward the marker']);
    } finally { setLoading(false); }
  }, []);

  return { route, steps, etaMin, distanceKm, loading, fetchRoute };
}
