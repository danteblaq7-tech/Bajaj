import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from './src/theme';
import { LangProvider, useLang, tx } from './src/i18n';
import * as SecureStore from 'expo-secure-store';
import DisclosureModal from './src/screens/DisclosureModal';
import { Screen, H, P, Button, Err, Chip } from './src/ui';
import { loadTokens, saveTokens, setLogoutHandler, me, errorText, updateMe, clearPushToken } from './src/api';
import * as Notifications from 'expo-notifications';
import { registerForPush } from './src/push';
import { useLocationPing } from './src/useLocationPing';
import LoginScreen from './src/screens/LoginScreen';
import ShiftStartScreen from './src/screens/ShiftStartScreen';
import OnlineScreen from './src/screens/OnlineScreen';
import TripScreen from './src/screens/TripScreen';
import EarningsScreen from './src/screens/EarningsScreen';
import EndShiftScreen from './src/screens/EndShiftScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <LangProvider><Root /></LangProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useTheme();
  const { lang } = useLang();
  const [booting, setBooting] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [driver, setDriver] = useState(null);
  const [screen, setScreen] = useState('home');
  const [err, setErr] = useState(null);

  const logout = useCallback(async () => { await clearPushToken().catch(() => {}); await saveTokens(null); setAuthed(false); setDriver(null); setScreen('home'); }, []);
  useEffect(() => { setLogoutHandler(logout); }, [logout]);

  // The server decides what the driver is doing (offline, online, on a trip). The app just follows it.
  const refresh = useCallback(async () => {
    try {
      const r = await me();
      setDriver(r.driver); setErr(null);
    } catch (e) {
      if (e.status === 403) { setErr(e.message); await logout(); } // suspended or not approved
      else setErr(errorText(e));
    }
  }, [logout]);

  useEffect(() => {
    (async () => {
      const tk = await loadTokens();
      if (tk) { setAuthed(true); await refresh(); }
      setBooting(false);
    })();
  }, []);

  const onLoggedIn = async () => { setAuthed(true); setErr(null); await refresh(); };

  // Push: register this phone so the server can alert it about ride offers even when the app is in the background.
  useEffect(() => {
    if (!authed || !driver) return;
    registerForPush().then((tk) => tk && updateMe({ push_token: tk })).catch(() => {});
  }, [authed, !!driver]);
  useEffect(() => {
    const a = Notifications.addNotificationReceivedListener(() => refresh());
    const b = Notifications.addNotificationResponseReceivedListener(() => refresh());
    return () => { a.remove(); b.remove(); };
  }, [refresh]);
  // Google Play requires an in-app explanation before background location is requested.
  const [disclosed, setDisclosed] = useState(null);
  useEffect(() => { SecureStore.getItemAsync('bgdisclosed').then((v) => setDisclosed(v === '1')).catch(() => setDisclosed(false)); }, []);
  const accept = async () => { try { await SecureStore.setItemAsync('bgdisclosed', '1'); } catch (e) { /* ignore */ } setDisclosed(true); };
  const loc = useLocationPing(authed && !!driver && disclosed === true && (driver.status === 'ONLINE' || driver.status === 'ON_TRIP'));

  useEffect(() => { if (authed && driver) updateMe({ language: lang }).catch(() => {}); }, [authed, !!driver, lang]);

  if (booting) return <Screen><ActivityIndicator color={t.sea} size="large" /></Screen>;
  if (!authed) return (<><LoginScreen onLoggedIn={onLoggedIn} />{err ? <View style={{ padding: 16 }}><Err>{err}</Err></View> : null}</>);
  if (!driver) return <Screen><H>Pwani Ride Driver</H><Err>{err}</Err><Button title="Retry" onPress={refresh} /><Button title="Sign out" kind="ghost" onPress={logout} /></Screen>;

  const props = { driver, refresh, loc, go: setScreen };
  let body;
  if (screen === 'earnings') body = <EarningsScreen {...props} />;
  else if (screen === 'endshift') body = <EndShiftScreen {...props} />;
  else if (driver.status === 'ON_TRIP') body = <TripScreen {...props} />;
  else if (driver.status === 'ONLINE') body = <OnlineScreen {...props} />;
  else body = (
    <>
      <View style={{ backgroundColor: t.sea, paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ color: t.onSea, fontSize: 18, fontWeight: '800' }}>{driver.name}</Text>
          <Text style={{ color: t.onSea }}>{tx(`Rating ${Number(driver.rating).toFixed(1)} · ${driver.total_trips} trips`)}</Text>
        </View>
        <Button title="Sign out" kind="ghost" onPress={logout} style={{ minHeight: 40, backgroundColor: t.bg }} />
      </View>
      <ShiftStartScreen {...props} />
    </>
  );
  return (
    <>
      {body}
      <DisclosureModal visible={disclosed === false && ['ACTIVE', 'ONLINE', 'ON_TRIP'].includes(driver.status)} onAccept={accept} />
    </>
  );
}
