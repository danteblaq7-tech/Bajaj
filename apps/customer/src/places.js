import * as Location from 'expo-location';

// Approximate coordinates for common stops on the Mombasa to Malindi corridor. Check and refine these with your team.
export const PRESETS = [
  { address: 'Mombasa CBD', lat: -4.0435, lng: 39.6682 },
  { address: 'Moi International Airport, Mombasa', lat: -4.0348, lng: 39.5942 },
  { address: 'Nyali, Mombasa', lat: -4.0200, lng: 39.7140 },
  { address: 'Mtwapa', lat: -3.9500, lng: 39.7450 },
  { address: 'Vipingo', lat: -3.8200, lng: 39.8000 },
  { address: 'Kilifi Town', lat: -3.6305, lng: 39.8499 },
  { address: 'Mnarani, Kilifi', lat: -3.6400, lng: 39.8650 },
  { address: 'Gede Ruins', lat: -3.3078, lng: 40.0204 },
  { address: 'Watamu', lat: -3.3540, lng: 40.0220 },
  { address: 'Malindi Town', lat: -3.2192, lng: 40.1169 },
];

export const label = (a) => [a.name, a.street, a.district || a.subregion, a.city].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 3).join(', ');

export async function currentPlace() {
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) throw new Error('Location permission is off. Pick your pickup from the list instead.');
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude: lat, longitude: lng } = pos.coords;
  let address = 'Current location';
  try { const r = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }); if (r[0]) address = label(r[0]) || address; } catch (e) { /* keep default */ }
  return { address, lat, lng };
}

export async function searchPlaces(text) {
  const hits = await Location.geocodeAsync(`${text}, Kenya`);
  const out = [];
  for (const h of hits.slice(0, 3)) {
    let address = text;
    try { const r = await Location.reverseGeocodeAsync({ latitude: h.latitude, longitude: h.longitude }); if (r[0]) address = label(r[0]) || text; } catch (e) { /* keep text */ }
    out.push({ address, lat: h.latitude, lng: h.longitude });
  }
  return out;
}
