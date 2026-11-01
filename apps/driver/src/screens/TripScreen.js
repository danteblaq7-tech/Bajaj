import React, { useCallback, useEffect, useState } from 'react';
import MapBox from '../components/MapBox';
import { useRoute } from '../useRoute';
import { getPos } from '../location';
import { tx } from '../i18n';
import { Alert, Linking, ActivityIndicator } from 'react-native';
import { Screen, H, P, Card, Button, Field, Err, Chip } from '../ui';
import { useTheme } from '../theme';
import { takePhoto } from '../photo';
import { currentTrip, startTrip, completeTrip, pickupParcel, deliverParcel, uploadPhoto, errorText } from '../api';

const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const navigate = (lat, lng) => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
const call = (phone) => Linking.openURL(`tel:+${phone}`);

export default function TripScreen({ refresh }) {
  const t = useTheme();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [otp, setOtp] = useState('');
  const [done, setDone] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await currentTrip();
      setTrip(r); setErr(null);
      if (!r.type) refresh(); // nothing active any more: sync status
    } catch (e) { setErr(errorText(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Where the driver is now, and the road to the next stop (pickup, then drop-off).
  const [pos, setPos] = useState(null);
  useEffect(() => {
    let live = true;
    const go = () => getPos().then((p) => live && p && setPos(p)).catch(() => {});
    go();
    const id = setInterval(go, 15000);
    return () => { live = false; clearInterval(id); };
  }, []);
  const tb = trip && trip.type === 'BOOKING' ? trip.booking : null;
  const tp = trip && trip.type === 'PARCEL' ? trip.parcel : null;
  const target = tb ? (tb.status === 'IN_PROGRESS' ? { lat: tb.dropoff_lat, lng: tb.dropoff_lng } : { lat: tb.pickup_lat, lng: tb.pickup_lng })
    : tp ? (tp.status === 'IN_TRANSIT' ? { lat: tp.dropoff_lat, lng: tp.dropoff_lng } : { lat: tp.pickup_lat, lng: tp.pickup_lng }) : null;
  const route = useRoute(pos, target);

  const run = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Screen>
        <H>Trip complete</H>
        <Card tone="sand">
          <P mute>You earned</P>
          <P bold style={{ fontSize: 30 }}>{kes(done.earnings)}</P>
        </Card>
        <Button title="Back online" onPress={refresh} />
      </Screen>
    );
  }
  if (loading) return <Screen><ActivityIndicator color={t.sea} size="large" /></Screen>;
  if (!trip || !trip.type) return <Screen><Err>{err}</Err><Button title="Retry" onPress={load} /></Screen>;

  // ---------- passenger ride ----------
  if (trip.type === 'BOOKING') {
    const b = trip.booking;
    const started = b.status === 'IN_PROGRESS';
    const place = started ? { a: b.dropoff_address, lat: b.dropoff_lat, lng: b.dropoff_lng } : { a: b.pickup_address, lat: b.pickup_lat, lng: b.pickup_lng };
    return (
      <Screen>
        <H>{started ? 'Trip in progress' : 'Go to pickup'}</H>
        <MapBox height={200} showUser route={route && route.points} markers={[{ id: 'target', lat: place.lat, lng: place.lng, color: started ? 'red' : 'green', title: started ? 'Drop-off' : 'Pickup' }]} />
        <Card tone="sand">
          <Chip text={started ? 'Heading to drop-off' : 'Heading to pickup'} />
          <P mute>{started ? 'Drop-off' : 'Pickup'}</P>
          <P bold style={{ fontSize: 20 }}>{place.a || 'See map'}</P>
          <Button title="Open navigation" onPress={() => navigate(place.lat, place.lng)} />
        </Card>
        <Card>
          <P bold>{b.customer_name || 'Customer'}</P>
          <P mute>{b.passengers} passenger{b.passengers === 1 ? '' : 's'} · {kes(b.fare)}</P>
          {b.customer_phone ? <Button title="Call customer" kind="ghost" onPress={() => call(b.customer_phone)} /> : null}
        </Card>
        <Err>{err}</Err>
        {started ? (
          <Button
            title="End trip" loading={busy}
            onPress={() => Alert.alert(tx('End this trip?'), tx('Only end the trip once the passenger has reached the drop-off.'), [
              { text: tx('Not yet'), style: 'cancel' },
              { text: tx('End trip'), onPress: () => run(async () => { const r = await completeTrip(b.id); setDone(r); }) },
            ])}
          />
        ) : (
          <Button title="Passenger on board: start trip" loading={busy} onPress={() => run(async () => { await startTrip(b.id); await load(); })} />
        )}
      </Screen>
    );
  }

  // ---------- parcel run ----------
  const p = trip.parcel;
  const transit = p.status === 'IN_TRANSIT';
  const place = transit ? { a: p.dropoff_address, lat: p.dropoff_lat, lng: p.dropoff_lng } : { a: p.pickup_address, lat: p.pickup_lat, lng: p.pickup_lng };
  const photoThen = (action) => run(async () => {
    const uri = await takePhoto();
    if (!uri) return;
    await action(await uploadPhoto(uri));
    setOtp(''); await load();
  });
  return (
    <Screen>
      <H>{transit ? 'Deliver parcel' : 'Collect parcel'}</H>
      <MapBox height={200} showUser route={route && route.points} markers={[{ id: 'target', lat: place.lat, lng: place.lng, color: transit ? 'red' : 'green', title: transit ? 'Drop-off' : 'Pickup' }]} />
      <Card tone="sand">
        <Chip text={p.tracking_id} />
        <P mute>{transit ? 'Drop-off' : 'Pickup'}</P>
        <P bold style={{ fontSize: 20 }}>{place.a || 'See map'}</P>
        <Button title="Open navigation" onPress={() => navigate(place.lat, place.lng)} />
      </Card>
      <Card>
        <P bold>{p.size} parcel · {p.weight} kg</P>
        {p.description ? <P mute>{p.description}</P> : null}
        <P>Recipient: {p.recipient_name}</P>
        <Button title="Call recipient" kind="ghost" onPress={() => call(p.recipient_phone)} />
      </Card>
      <Err>{err}</Err>
      {transit ? (
        <Card>
          <Field label="Delivery code from the recipient" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={4} placeholder="4 digits" />
          <Button title="Take photo and confirm delivery" loading={busy} disabled={otp.length !== 4} onPress={() => photoThen((url) => deliverParcel(p.id, otp, url))} />
        </Card>
      ) : (
        <Button title="Take photo and confirm pickup" loading={busy} onPress={() => photoThen((url) => pickupParcel(p.id, url))} />
      )}
    </Screen>
  );
}
