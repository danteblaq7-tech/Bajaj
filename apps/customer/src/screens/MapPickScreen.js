import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView from 'react-native-maps';
import * as Location from 'expo-location';
import { Header, P, Button } from '../ui';
import { useTheme } from '../theme';
import { currentPlace, label } from '../places';

const FALLBACK = { latitude: -3.63, longitude: 39.85, latitudeDelta: 0.3, longitudeDelta: 0.3 };

// Drag the map under the centre pin, then confirm. params: { title, onPick(place) }
export default function MapPickScreen({ nav, params }) {
  const t = useTheme();
  const [initial, setInitial] = useState(null);
  const [center, setCenter] = useState(null);
  const [addr, setAddr] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    currentPlace()
      .then((p) => { const r = { latitude: p.lat, longitude: p.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }; setInitial(r); setCenter(r); })
      .catch(() => { setInitial(FALLBACK); setCenter(FALLBACK); });
  }, []);

  const moved = (r) => {
    setCenter(r);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const a = await Location.reverseGeocodeAsync({ latitude: r.latitude, longitude: r.longitude }); setAddr(a[0] ? label(a[0]) : ''); } catch (e) { setAddr(''); }
    }, 600);
  };
  const confirm = () => { params.onPick({ address: addr || 'Dropped pin', lat: center.latitude, lng: center.longitude }); nav.pop(); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <View style={{ padding: 16 }}><Header title={params.title || 'Pick on map'} onBack={nav.pop} /></View>
      <View style={{ flex: 1 }}>
        {initial ? <MapView style={{ flex: 1 }} initialRegion={initial} showsUserLocation onRegionChangeComplete={moved} toolbarEnabled={false} /> : null}
        <View pointerEvents="none" style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -16, marginTop: -40 }}>
          <Text style={{ fontSize: 36 }}>{'\u{1F4CD}'}</Text>
        </View>
      </View>
      <View style={{ padding: 16, gap: 10, backgroundColor: t.surface }}>
        <P bold>{addr || 'Move the map to place the pin'}</P>
        <Button title="Confirm this location" onPress={confirm} disabled={!center} />
      </View>
    </SafeAreaView>
  );
}
