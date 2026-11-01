import * as ImagePicker from 'expo-image-picker';

// Opens the camera and returns the photo's local URI, or null if cancelled or permission is denied.
export async function takePhoto({ front = false } = {}) {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission is needed. Enable it in your phone settings.');
  const r = await ImagePicker.launchCameraAsync({
    quality: 0.5,
    cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  return r.canceled || !r.assets || !r.assets.length ? null : r.assets[0].uri;
}
