import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from './src/theme';
import { LangProvider, useLang } from './src/i18n';
import { Screen, H, Button, Err, Spinner } from './src/ui';
import { loadTokens, saveTokens, setLogoutHandler, getMe, errorText, updateMe, clearPushToken } from './src/api';
import * as Notifications from 'expo-notifications';
import { registerForPush } from './src/push';
import MapPickScreen from './src/screens/MapPickScreen';
import AuthScreen from './src/screens/AuthScreen';
import Tabs from './src/screens/Tabs';
import RideScreen from './src/screens/RideScreen';
import PlaceScreen from './src/screens/PlaceScreen';
import PayScreen from './src/screens/PayScreen';
import TrackScreen from './src/screens/TrackScreen';
import SubscriptionsScreen from './src/screens/SubscriptionsScreen';
import { TourListScreen, TourBookScreen } from './src/screens/ToursScreens';
import { ParcelCreateScreen, ParcelTrackScreen } from './src/screens/ParcelScreens';

const SCREENS = {
  ride: RideScreen, place: PlaceScreen, mapPick: MapPickScreen, pay: PayScreen, track: TrackScreen, subs: SubscriptionsScreen,
  tours: TourListScreen, tourBook: TourBookScreen, parcel: ParcelCreateScreen, parcelTrack: ParcelTrackScreen,
};

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
  const [user, setUser] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('home');
  const [stack, setStack] = useState([]); // screens pushed on top of the tabs
  const [tabsKey, setTabsKey] = useState(0); // bump to reload the tabs' data after a payment

  // Tiny stack navigator: enough for this app and no extra dependency.
  const nav = {
    push: (name, params) => setStack((s) => [...s, { name, params }]),
    pop: () => setStack((s) => s.slice(0, -1)),
    replace: (name, params) => setStack((s) => [...s.slice(0, -1), { name, params }]),
    reset: () => { setStack([]); setTabsKey((k) => k + 1); },
  };

  const logout = useCallback(async () => { await clearPushToken().catch(() => {}); await saveTokens(null); setAuthed(false); setUser(null); setStack([]); setTab('home'); }, []);
  useEffect(() => { setLogoutHandler(logout); }, [logout]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length) { setStack((s) => s.slice(0, -1)); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  const refreshUser = useCallback(async () => {
    try { const r = await getMe(); setUser(r.user); setErr(null); } catch (e) { setErr(errorText(e)); }
  }, []);
  useEffect(() => {
    (async () => {
      const tk = await loadTokens();
      if (tk) { setAuthed(true); await refreshUser(); }
      setBooting(false);
    })();
  }, []);
  const onDone = async () => { setAuthed(true); await refreshUser(); };

  // Push: register this phone, and open the right trip when a notification is tapped.
  useEffect(() => {
    if (!authed || !user) return;
    registerForPush().then((tk) => tk && updateMe({ push_token: tk })).catch(() => {});
  }, [authed, !!user]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = (r.notification.request.content.data) || {};
      if (data.booking_id) nav.push('track', { id: data.booking_id });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => { if (authed && user && user.language && user.language !== lang) updateMe({ language: lang }).catch(() => {}); }, [authed, user && user.language, lang]);

  if (booting) return <Screen><Spinner /></Screen>;
  if (!authed) return <AuthScreen onDone={onDone} />;
  if (!user) return <Screen><H>Pwani Ride</H><Err>{err}</Err><Button title="Retry" onPress={refreshUser} /><Button title="Sign out" kind="ghost" onPress={logout} /></Screen>;

  // Every pushed screen stays mounted (hidden when not on top) so a form keeps its state while you pick a place.
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, display: stack.length ? 'none' : 'flex' }}>
        <Tabs key={tabsKey} tab={tab} setTab={setTab} nav={nav} user={user} refreshUser={refreshUser} logout={logout} />
      </View>
      {stack.map((s, i) => {
        const Cmp = SCREENS[s.name];
        return (
          <View key={i} style={{ flex: 1, display: i === stack.length - 1 ? 'flex' : 'none' }}>
            <Cmp nav={nav} params={s.params || {}} user={user} />
          </View>
        );
      })}
    </View>
  );
}
