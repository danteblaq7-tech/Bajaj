// Android emulator reaches your computer at 10.0.2.2. On a real phone use your computer's LAN IP, e.g.
// EXPO_PUBLIC_API_URL=http://192.168.1.20:4000/api npx expo start
export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:4000/api';
