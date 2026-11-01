import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRoute } from '../useRoute';
import { locale } from '../i18n';
import MapBox from '../components/MapBox';
import { Screen, Header, P, Card, Button, Err, Choice, Row, Chip, kes } from '../ui';
import { useTheme } from '../theme';
import { currentPlace } from '../places';
import { estimate, createBooking, mySubs, errorText } from '../api';

export default function RideScreen({ nav }) {
  const t = useTheme();
  const [pickup, setPickup] = useState(null);
  const [drop, setDrop] = useState(null);
  const [pax, setPax] = useState(1);
  const [quote, setQuote] = useState(null);
  const [sub, setSub] = useState(null);
  const [useSub, setUseSub] = useState(false);

  // "Later": pick a day and a time in 30-minute steps. The default is the next half hour that is at least an hour away.
  const [slot0] = useState(() => { const x = new Date(Date.now() + 3600000); let m = Math.ceil((x.getHours() * 60 + x.getMinutes()) / 30) * 30; let d = 0; if (m >= 1380) { d = 1; m = 480; } return { d, m: Math.max(300, m) }; });
  const [when, setWhen] = useState('now');
  const [dayIdx, setDayIdx] = useState(slot0.d);
  const [mins, setMins] = useState(slot0.m);
  const scheduledAt = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + dayIdx); d.setMinutes(mins); return d; };
  const tooSoon = when === 'later' && scheduledAt().getTime() < Date.now() + 15 * 60000;
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const dayList = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { currentPlace().then(setPickup).catch(() => {}); }, []);
  useEffect(() => { mySubs().then((r) => setSub(r.subscriptions.find((s) => s.status === 'ACTIVE' || s.status === 'GRACE') || null)).catch(() => {}); }, []);

  const body = (type) => ({
    service_type: type, passengers: pax, ...(when === 'later' ? { scheduled_at: scheduledAt().toISOString() } : {}),
    pickup_address: pickup.address, pickup_lat: pickup.lat, pickup_lng: pickup.lng,
    dropoff_address: drop.address, dropoff_lat: drop.lat, dropoff_lng: drop.lng,
  });
  useEffect(() => {
    setQuote(null); setErr(null);
    if (!pickup || !drop) return undefined;
    let live = true;
    estimate(body('RIDE')).then((q) => live && setQuote(q)).catch((e) => live && setErr(errorText(e)));
    return () => { live = false; };
  }, [pickup, drop]);

  const route = useRoute(pickup, drop);

  const request = async () => {
    setBusy(true); setErr(null);
    try {
      if (useSub && sub) {
        const r = await createBooking({ ...body('SUBSCRIPTION'), subscription_id: sub.id });
        nav.replace('track', { id: r.booking.id });
      } else {
        const r = await createBooking(body('RIDE'));
        nav.replace('pay', { purpose: 'BOOKING', targetId: r.booking.id, amount: r.booking.fare, title: 'Pay for your ride', after: () => nav.replace('track', { id: r.booking.id }) });
      }
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  const choose = (setter, title, allowCurrent) => nav.push('place', { title, allowCurrent, onPick: setter });

  return (
    <Screen>
      <Header title="Book a ride" onBack={nav.pop} />
      <Card>
        <P mute>Pickup</P>
        <Row left={<P bold>{pickup ? pickup.address : 'Finding your location...'}</P>} right={<Button title="Change" kind="ghost" onPress={() => choose(setPickup, 'Pickup point', true)} style={{ minHeight: 44 }} />} />
        <P mute>Where to?</P>
        <Row left={<P bold>{drop ? drop.address : 'Choose a destination'}</P>} right={<Button title={drop ? 'Change' : 'Choose'} kind="ghost" onPress={() => choose(setDrop, 'Destination', false)} style={{ minHeight: 44 }} />} />
      </Card>
      <Card>
        <P mute>Passengers (up to 3 per tuktuk)</P>
        <Choice options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} value={pax} onChange={setPax} />
      </Card>
      <Card>
        <P mute>When</P>
        <Choice value={when} onChange={setWhen} options={[{ value: 'now', label: 'Now' }, { value: 'later', label: 'Later' }]} />
        {when === 'later' ? (<>
          <P mute>Date</P>
          <Choice value={dayIdx} onChange={setDayIdx} options={dayList.map((d, i) => ({ value: i, label: i === 0 ? 'Today' : d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric' }) }))} />
          <P mute>Time</P>
          <Row
            left={<P bold style={{ fontSize: 28 }}>{fmt(mins)}</P>}
            right={<View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title="−" kind="ghost" onPress={() => setMins((m) => Math.max(300, m - 30))} style={{ minWidth: 56 }} />
              <Button title="+" kind="ghost" onPress={() => setMins((m) => Math.min(1380, m + 30))} style={{ minWidth: 56 }} />
            </View>}
          />
          {tooSoon ? <Err>Pick a time at least 15 minutes from now.</Err> : <P mute>We assign your driver about 30 minutes before pickup. You pay now to confirm your booking.</P>}
        </>) : null}
      </Card>
      {pickup && drop ? (
        <MapBox height={190} route={route && route.points} markers={[
          { id: 'p', lat: pickup.lat, lng: pickup.lng, color: 'green', title: 'Pickup' },
          { id: 'd', lat: drop.lat, lng: drop.lng, color: 'red', title: 'Destination' },
        ]} />
      ) : null}
      {sub ? (
        <Card tone="sand">
          <Chip text="Subscription active" color={t.ok} />
          <P>Use your monthly subscription for this ride? No payment needed.</P>
          <Choice options={[{ value: false, label: 'Pay normally' }, { value: true, label: 'Use subscription' }]} value={useSub} onChange={setUseSub} />
        </Card>
      ) : null}
      {quote ? (
        <Card tone="sand">
          <P mute>{`Fixed fare · ${quote.distance_km} km`}</P>
          <P bold style={{ fontSize: 30 }}>{useSub && sub ? 'Included' : kes(quote.fare)}</P>
        </Card>
      ) : null}
      <Err>{err}</Err>
      <Button title={useSub && sub ? 'Request ride' : 'Continue to payment'} onPress={request} loading={busy} disabled={!quote || tooSoon} />
    </Screen>
  );
}
