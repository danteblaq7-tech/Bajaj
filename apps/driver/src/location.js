import * as Location from 'expo-location';

export async function getPos() {
  const p = await Location.requestForegroundPermissionsAsync();
  if (!p.granted) return null;
  const x = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: x.coords.latitude, lng: x.coords.longitude };
}
