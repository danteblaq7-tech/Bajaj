import React, { useCallback, useEffect, useState } from 'react';
import { locale } from '../i18n';
import { Share } from 'react-native';
import { Screen, Header, P, Card, Button, Field, Err, Choice, Row, Chip, Spinner, kes } from '../ui';
import { useTheme } from '../theme';
import { currentPlace } from '../places';
import { createParcel, trackParcel, errorText } from '../api';

export function ParcelCreateScreen({ nav }) {
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [weight, setWeight] = useState('1');
  const [size, setSize] = useState('SMALL');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { currentPlace().then(setPickup).catch(() => {}); }, []);

  const ok = pickup && drop && name.trim().length > 1 && phone.length >= 9 && Number(weight) > 0;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createParcel({
        recipient_name: name.trim(), recipient_phone: phone, weight: Number(weight), size, ...(desc.trim() ? { description: desc.trim() } : {}),
        pickup_address: pickup.address, pickup_lat: pickup.lat, pickup_lng: pickup.lng, dropoff_address: drop.address, dropoff_lat: drop.lat, dropoff_lng: drop.lng,
      });
      const p = r.parcel;
      nav.replace('pay', { purpose: 'PARCEL', targetId: p.id, amount: p.fare, title: 'Pay for delivery', after: () => nav.replace('parcelTrack', { trackingId: p.tracking_id }) });
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };

  return (
    <Screen>
      <Header title="Send a parcel" onBack={nav.pop} />
      <Card>
        <P mute>Pickup</P>
        <Row left={<P bold>{pickup ? pickup.address : 'Finding your location...'}</P>} right={<Button title="Change" kind="ghost" style={{ minHeight: 44 }} onPress={() => nav.push('place', { title: 'Pickup point', allowCurrent: true, onPick: setPickup })} />} />
        <P mute>Deliver to</P>
        <Row left={<P bold>{drop ? drop.address : 'Choose a drop-off'}</P>} right={<Button title={drop ? 'Change' : 'Choose'} kind="ghost" style={{ minHeight: 44 }} onPress={() => nav.push('place', { title: 'Drop-off point', onPick: setDrop })} />} />
      </Card>
      <Field label="Recipient name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Recipient phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0712 345 678" />
      <Card>
        <P mute>Size</P>
        <Choice value={size} onChange={setSize} options={[{ value: 'SMALL', label: 'Small' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'LARGE', label: 'Large' }]} />
        <Field label="Weight (kg, up to 30)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        <Field label="What is inside? (optional)" value={desc} onChangeText={setDesc} />
      </Card>
      <P mute>No cash, valuables or illegal items. The recipient gets a code by SMS and must give it to the driver.</P>
      <Err>{err}</Err>
      <Button title="See price and pay" onPress={submit} loading={busy} disabled={!ok} />
    </Screen>
  );
}

const LABEL = { PENDING: 'Waiting for payment', PAID: 'Finding a driver', ASSIGNED: 'Driver heading to pickup', IN_TRANSIT: 'On its way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };

// params: { trackingId, id?, fare? }  (id and fare let the sender pay an unpaid parcel)
export function ParcelTrackScreen({ nav, params }) {
  const t = useTheme();
  const [p, setP] = useState(null);
  const [err, setErr] = useState(null);
  const load = useCallback(async () => { try { setP(await trackParcel(params.trackingId)); setErr(null); } catch (e) { setErr(errorText(e)); } }, [params.trackingId]);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!p || !['DELIVERED', 'CANCELLED'].includes(p.status)) load(); }, 8000);
    return () => clearInterval(id);
  }, [load, p && p.status]);

  return (
    <Screen>
      <Header title="Parcel tracking" onBack={nav.reset} />
      <Card tone="sand">
        <Chip text={params.trackingId} />
        {p ? <P bold style={{ fontSize: 22 }}>{LABEL[p.status] || p.status}</P> : err ? null : <Spinner />}
        {p && p.picked_up_at ? <P mute>Collected {new Date(p.picked_up_at).toLocaleString(locale())}</P> : null}
        {p && p.delivered_at ? <P mute>Delivered {new Date(p.delivered_at).toLocaleString(locale())}</P> : null}
      </Card>
      <Err>{err}</Err>
      {p && p.status === 'PENDING' && params.id ? <Button title={`Pay ${kes(params.fare)}`} onPress={() => nav.push('pay', { purpose: 'PARCEL', targetId: params.id, amount: params.fare, title: 'Pay for delivery', after: () => nav.replace('parcelTrack', params) })} /> : null}
      <Button title="Share tracking ID" kind="ghost" onPress={() => Share.share({ message: `Track your Pwani Ride parcel: ${params.trackingId}` })} />
      <Button title="Done" kind="ghost" onPress={nav.reset} />
    </Screen>
  );
}
