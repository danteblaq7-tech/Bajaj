import { useColorScheme } from 'react-native';

// Coastal palette: white, sea blue, sand. Follows the phone's light/dark setting.
const light = { bg: '#F7F4EE', surface: '#FFFFFF', ink: '#0F2A33', mute: '#5C7480', sea: '#0E7C9B', onSea: '#FFFFFF',
  sand: '#D8C3A0', sandSoft: '#EFE5D2', line: '#E3DACA', ok: '#1E8F62', bad: '#C4432F', onBad: '#FFFFFF', warn: '#B7740F' };
const dark = { bg: '#0A1A21', surface: '#112832', ink: '#E8F1F4', mute: '#8FA9B4', sea: '#3AB5D6', onSea: '#06222B',
  sand: '#CDB68E', sandSoft: '#1C3340', line: '#1F3C49', ok: '#4CC794', bad: '#F0816E', onBad: '#2A0E0A', warn: '#E3A748' };

export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);
