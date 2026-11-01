import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Asks for permission and returns this phone's Expo push token, or null (simulator, permission denied, Expo Go on Android).
// Remote push needs a development or production build and an EAS project id (see README).
export async function registerForPush() {
  try {
    if (!Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('rides', { name: 'Ride updates', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 400, 200, 400] });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId) || (Constants.easConfig && Constants.easConfig.projectId);
    const r = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return r.data;
  } catch (e) { return null; }
}
