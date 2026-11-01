import { useEffect, useState } from 'react';
import { getRoute } from './api';

// Driving route between two points: { points: [{lat,lng}], distance_km, duration_min } or null while loading / unavailable.
// Re-fetches only when an end moves by roughly 100 m (the server also caches).
export function useRoute(from, to) {
  const [route, setRoute] = useState(null);
  const k = (p) => (p ? `${p.lat.toFixed(3)},${p.lng.toFixed(3)}` : '');
  useEffect(() => {
    if (!from || !to) { setRoute(null); return undefined; }
    let live = true;
    getRoute(from, to).then((r) => live && setRoute(r)).catch(() => live && setRoute(null));
    return () => { live = false; };
  }, [k(from), k(to)]);
  return route;
}
