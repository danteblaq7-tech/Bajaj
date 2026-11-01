import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { loadTokens, pingLocation } from './api';

export const TASK = 'pwani-driver-location';

// Runs even when the app is closed or the screen is off (as long as the driver is online).
// This file is imported from index.js so the task exists as soon as the app process starts.
TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error || !data || !data.locations || !data.locations.length) return;
  const l = data.locations[data.locations.length - 1];
  try {
    await loadTokens(); // a background start has no screens, so load the saved sign-in first
    const kmh = l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed * 3.6 : null;
    await pingLocation(l.coords.latitude, l.coords.longitude, kmh);
  } catch (e) { /* the next update will try again */ }
});

// Returns 'background' (works with the app closed), 'foreground' (only while the app is open) or 'denied'.
export async function startBackground() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) return 'foreground';
  if (!(await Location.hasStartedLocationUpdatesAsync(TASK))) {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 0, pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation, showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Pwani Ride is online', notificationBody: 'Sharing your location so you can receive rides.', notificationColor: '#0E7C9B' },
    });
  }
  return 'background';
}
export async function stopBackground() {
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
}
