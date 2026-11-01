import React, { useEffect, useState } from 'react';
import { locale } from '../i18n';
import { Screen, Header, P, Card, Button, Err, Choice, Row, Chip, Spinner, kes } from '../ui';
import { currentPlace } from '../places';
import { getTours, bookTour, errorText } from '../api';

export function TourListScreen({ nav }) {
  const [tours, setTours] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getTours().then((r) => setTours(r.tours)).catch((e) => setErr(errorText(e))); }, []);
  return (
    <Screen>
      <Header title="Mini tours" onBack={nav.pop} />
      <P mute>Fixed-price sightseeing in a clean, air-conditioned tuktuk with a trained driver.</P>
      <Err>{err}</Err>
      {!tours && !err ? <Spinner /> : null}
      {tours && !tours.length ? <P mute>No tours available right now.</P> : null}
      {(tours || []).map((t) => (
        <Card key={t.id} onPress={() => nav.push('tourBook', { tour: t })}>
          <P bold style={{ fontSize: 18 }}>{t.name}</P>
          <P mute>{t.description}</P>
          <Row left={<Chip text={`${t.duration_hours} hours`} />} right={<P bold>{kes(t.price)}</P>} />
        </Card>
      ))}
    </Screen>
  );
}

const SLOTS = ['08:00', '10:00', '13:00', '15:00'];
const DAYS = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; });
const at = (day, slot) => { const [h, m] = slot.split(':').map(Number); const d = new Date(day); d.setHours(h, m, 0, 0); return d; };

export function TourBookScreen({ nav, params }) {
  const tour = params.tour;
  const [pickup, setPickup] = useState(null);
  const [day, setDay] = useState(1);
  const [slot, setSlot] = useState('10:00');
  const [pax, setPax] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { currentPlace().then(setPickup).catch(() => {}); }, []);

  const tuktuks = Math.ceil(pax / 3);
  const total = tour.price * tuktuks;
  const when = at(DAYS[day], slot);
  const soon = when.getTime() < Date.now() + 2 * 3600000 + 60000; // the server needs 2 hours notice

  const book = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await bookTour(tour.id, { pickup_address: pickup.address, pickup_lat: pickup.lat, pickup_lng: pickup.lng, scheduled_at: when.toISOString(), passengers: pax });
      nav.replace('pay', { purpose: 'BOOKING', targetId: r.booking.id, amount: r.total_fare, title: 'Pay for your tour', after: () => nav.replace('track', { id: r.booking.id }) });
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };

  return (
    <Screen>
      <Header title={tour.name} onBack={nav.pop} />
      <Card>
        <P>{tour.description}</P>
        {(tour.stops || []).map((s, i) => <P key={i} mute>{i + 1}. {s.name}{s.minutes ? ` · ${s.minutes} min` : ''}</P>)}
      </Card>
      <Card>
        <P mute>Pickup point</P>
        <Row left={<P bold>{pickup ? pickup.address : 'Finding your location...'}</P>} right={<Button title="Change" kind="ghost" style={{ minHeight: 44 }} onPress={() => nav.push('place', { title: 'Pickup point', allowCurrent: true, onPick: setPickup })} />} />
      </Card>
      <Card>
        <P mute>Day</P>
        <Choice value={day} onChange={setDay} options={DAYS.map((d, i) => ({ value: i, label: i === 0 ? 'Today' : d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric' }) }))} />
        <P mute>Start time</P>
        <Choice value={slot} onChange={setSlot} options={SLOTS.map((s) => ({ value: s, label: s, disabled: at(DAYS[day], s).getTime() < Date.now() + 2 * 3600000 + 60000 }))} />
        {soon ? <P mute>Tours need at least 2 hours notice. Pick a later time.</P> : null}
      </Card>
      <Card>
        <P mute>People</P>
        <Choice value={pax} onChange={setPax} options={[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => ({ value: n, label: String(n) }))} />
        <P mute>{`${tuktuks} tuktuk${tuktuks > 1 ? 's' : ''} (3 people each)`}</P>
      </Card>
      <Card tone="sand"><P mute>Total</P><P bold style={{ fontSize: 30 }}>{kes(total)}</P></Card>
      <Err>{err}</Err>
      <Button title="Continue to payment" onPress={book} loading={busy} disabled={!pickup || soon} />
    </Screen>
  );
}
