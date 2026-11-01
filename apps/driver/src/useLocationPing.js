import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { pingLocation } from './api';
import { startBackground, stopBackground } from './backgroundLocation';

// While `active` (driver online or on a trip) the position is sent about every 10 seconds.
// Preferred: background tracking (keeps working with the screen off or the app closed). If the driver only allows
// location "while using the app", it falls back to foreground tracking. Returns 'pending' | 'background' | 'foreground' | 'denied'.
export function useLocationPing(active) {
  const [state, setState] = useState('pending');
  useEffect(() => {
    if (!active) { stopBackground().catch(() => {}); return undefined; }
    let sub = null, cancelled = false;
    (async () => {
      let mode = 'denied';
      try { mode = await startBackground(); } catch (e) { mode = 'foreground'; }
      if (cancelled) return;
      setState(mode);
      if (mode !== 'foreground') return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 0 },
        (pos) => {
          const kmh = pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : null;
          pingLocation(pos.coords.latitude, pos.coords.longitude, kmh).catch(() => {});
        }
      );
      if (cancelled && sub) sub.remove();
    })();
    return () => { cancelled = true; if (sub) sub.remove(); };
  }, [active]);
  return state;
}
