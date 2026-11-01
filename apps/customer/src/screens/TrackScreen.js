import React, { useCallback, useEffect, useState } from 'react';
import MapBox from '../components/MapBox';
import { useRoute } from '../useRoute';
import { tx, locale } from '../i18n';
import { Alert, Linking } from 'react-native';
import { Screen, Header, P, Card, Button, Err, Chip, Stars, Field, Spinner, kes } from '../ui';
import { useTheme } from '../theme';
import { getBooking, cancelBooking, rateBooking, errorText } from '../api';

const STEPS = ['Payment', 'Finding your driver', 'Driver on the way', 'On your trip', 'Arrived'];
const IDX = { PENDING: 0, PAID: 1, ASSIGNED: 2, IN_PROGRESS: 3, COMPLETED: 4 };

export default function TrackScreen({ nav, params }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await getBooking(params.id)); setErr(null); } catch (e) { setErr(errorText(e)); }
  }, [params.id]);
  useEffect(() => {
    load();
    const id = setInterval(() => { if (!data || !['COMPLETED', 'CANCELLED'].includes(data.booking.status)) load(); }, 4000);
    return () => clearInterval(id);
  }, [load, data && data.booking.status]);

  // Route: driver to pickup while they approach, driver to destination during the trip, otherwise pickup to destination.
  const bk = data && data.booking, dv = data && data.driver;
  const rFrom = bk ? (dv && dv.location && ['ASSIGNED', 'IN_PROGRESS'].includes(bk.status) ? { lat: dv.location.lat, lng: dv.location.lng } : { lat: bk.pickup_lat, lng: bk.pickup_lng }) : null;
  const rTo = bk ? (bk.status === 'ASSIGNED' ? { lat: bk.pickup_lat, lng: bk.pickup_lng } : { lat: bk.dropoff_lat, lng: bk.dropoff_lng }) : null;
  const route = useRoute(rFrom, rTo);

  if (!data) return <Screen><Header title="Your ride" onBack={nav.reset} /><Err>{err}</Err>{err ? null : <Spinner />}</Screen>;
  const b = data.booking, d = data.driver, step = IDX[b.status];
  const etaMin = route ? route.duration_min : (d ? d.eta_min : null);
  const cancellable = ['PENDING', 'PAID', 'ASSIGNED'].includes(b.status);

  const cancel = () => Alert.alert(tx('Cancel this ride?'), tx(b.fare > 0 && b.status !== 'PENDING' ? 'You will be refunded to your Pwani Ride wallet.' : 'Are you sure?'), [
    { text: tx('Keep ride'), style: 'cancel' },
    { text: tx('Cancel ride'), style: 'destructive', onPress: async () => { try { await cancelBooking(b.id); await load(); } catch (e) { setErr(errorText(e)); } } },
  ]);
  const rate = async () => {
    setBusy(true);
    try { await rateBooking(b.id, stars, comment.trim()); setRated(true); } catch (e) { if (e.status === 409 || e.status === 400) setRated(true); else setErr(errorText(e)); } finally { setBusy(false); }
  };
  const scheduled = b.scheduled_at && b.status === 'PAID' && !d ? new Date(b.scheduled_at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <Screen>
      <Header title={b.status === 'CANCELLED' ? 'Ride cancelled' : 'Your ride'} onBack={nav.reset} />
      <Err>{err}</Err>

      {b.status !== 'CANCELLED' ? (
        <Card tone="sand">
          <Chip text={b.status === 'PAID' && !d ? STEPS[1] : STEPS[step]} color={b.status === 'COMPLETED' ? t.ok : t.sea} />
          {scheduled ? <P>{`Scheduled for ${scheduled}. We assign your driver about 30 minutes before.`}</P> : null}
          {b.status === 'PAID' && !d && !scheduled ? <P mute>If all tuktuks are busy we keep looking. You can cancel for a refund at any time.</P> : null}
          {d && b.status === 'ASSIGNED' && etaMin != null ? <P bold style={{ fontSize: 22 }}>{`Arriving in about ${etaMin} min`}</P> : null}
          {d && b.status === 'IN_PROGRESS' && etaMin != null ? <P bold style={{ fontSize: 22 }}>{`About ${etaMin} min to your destination`}</P> : null}
        </Card>
      ) : null}

      {b.status !== 'CANCELLED' ? (
        <MapBox height={230} route={route && route.points} markers={[
          { id: 'p', lat: b.pickup_lat, lng: b.pickup_lng, color: 'green', title: 'Pickup' },
          { id: 'd', lat: b.dropoff_lat, lng: b.dropoff_lng, color: 'red', title: 'Destination' },
          ...(d && d.location ? [{ id: 'drv', lat: d.location.lat, lng: d.location.lng, color: 'blue', title: d.name }] : []),
        ]} />
      ) : null}

      {d ? (
        <Card>
          <P bold style={{ fontSize: 20 }}>{d.name}</P>
          <P mute>{d.plate} · Rating {Number(d.rating).toFixed(1)}</P>
          {d.location ? <>
            {d.location.estimated ? <P mute>Last known position (signal weak)</P> : null}
            <Button title="See driver on map" kind="ghost" onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${d.location.lat},${d.location.lng}`)} />
          </> : null}
        </Card>
      ) : null}

      <Card>
        <P mute>From</P><P bold>{b.pickup_address}</P>
        <P mute>To</P><P bold>{b.dropoff_address}</P>
        <P mute>{b.fare > 0 ? kes(b.fare) : 'Covered by subscription'}</P>
      </Card>

      {b.status === 'PENDING' ? <Button title="Pay now" onPress={() => nav.push('pay', { purpose: 'BOOKING', targetId: b.id, amount: b.fare, title: 'Pay for your ride', after: () => nav.replace('track', { id: b.id }) })} /> : null}
      {cancellable ? <Button title="Cancel ride" kind="ghost" onPress={cancel} /> : null}

      {b.status === 'COMPLETED' && b.driver_id ? (
        rated ? <Card tone="sand"><P bold>Thanks for your feedback.</P></Card> : (
          <Card>
            <P bold>How was your ride?</P>
            <Stars value={stars} onChange={setStars} />
            <Field value={comment} onChangeText={setComment} placeholder="Add a comment (optional)" />
            <Button title="Submit rating" onPress={rate} loading={busy} disabled={!stars} />
          </Card>
        )
      ) : null}
      {['COMPLETED', 'CANCELLED'].includes(b.status) ? <Button title="Done" kind="ghost" onPress={nav.reset} /> : null}
    </Screen>
  );
}
