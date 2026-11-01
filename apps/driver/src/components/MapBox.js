import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

const COAST = { latitude: -3.63, longitude: 39.85, latitudeDelta: 1.2, longitudeDelta: 1.2 };

// markers: [{ id, lat, lng, color, title }]   route: [{ lat, lng }] (drawn as a line)
// The map re-frames itself when the set of markers changes or a route first appears, not on every small move,
// so a live driver marker can glide without the camera jumping.
export default function MapBox({ markers = [], route = null, height = 200, showUser = false, style }) {
  const ref = useRef(null);
  const hasRoute = !!(route && route.length > 1);
  const key = markers.map((m) => m.id).join('|') + (hasRoute ? '|route' : '');
  const fit = () => {
    if (!ref.current) return;
    const pts = [...markers.map((m) => ({ latitude: m.lat, longitude: m.lng })), ...(hasRoute ? route.map((p) => ({ latitude: p.lat, longitude: p.lng })) : [])];
    if (!pts.length) return;
    if (pts.length === 1) { ref.current.animateToRegion({ ...pts[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400); return; }
    ref.current.fitToCoordinates(pts, { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true });
  };
  useEffect(() => { fit(); }, [key]);
  return (
    <View style={[{ height, borderRadius: 16, overflow: 'hidden' }, style]}>
      <MapView ref={ref} style={{ flex: 1 }} initialRegion={COAST} showsUserLocation={showUser} onMapReady={fit} toolbarEnabled={false}>
        {hasRoute ? <Polyline coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#0E7C9B" strokeWidth={5} /> : null}
        {markers.map((m) => <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }} title={m.title} pinColor={m.color} />)}
      </MapView>
    </View>
  );
}
