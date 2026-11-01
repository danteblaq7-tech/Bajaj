import React, { useEffect, useRef, useState } from 'react';
import MapBox from '../components/MapBox';
import { getPos } from '../location';
import { View, Vibration } from 'react-native';
import { Screen, H, P, Card, Button, Err, Chip } from '../ui';
import { useTheme } from '../theme';
import { currentOffer, acceptOffer, declineOffer, errorText } from '../api';

const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;

export default function OnlineScreen({ driver, go, refresh, loc }) {
  const t = useTheme();
  const [offer, setOffer] = useState(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [offline, setOffline] = useState(false);
  const seen = useRef(null);
  const [me, setMe] = useState(null);
  useEffect(() => { getPos().then(setMe).catch(() => {}); }, []);

  // Ask for a new ride offer every 3 seconds (push notifications will replace this later).
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const { offer: o } = await currentOffer();
        if (!live) return;
        setOffline(false);
        if (o) {
          if (seen.current !== o.id) { seen.current = o.id; Vibration.vibrate([0, 500, 250, 500]); }
          setOffer({ ...o, expiresAt: Date.now() + o.seconds_left * 1000 });
        } else setOffer(null);
      } catch (e) {
        if (!live) return;
        setOffline(true);
        if (e.status === 403) refresh(); // suspended: let the app shell handle it
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { live = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!offer) return undefined;
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000))), 500);
    setLeft(Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000)));
    return () => clearInterval(id);
  }, [offer && offer.id, offer && offer.expiresAt]);

  const accept = async () => {
    setBusy(true); setMsg(null);
    try { await acceptOffer(offer.id); Vibration.cancel(); await refresh(); } catch (e) { setMsg(errorText(e)); setOffer(null); } finally { setBusy(false); }
  };
  const decline = async () => {
    setBusy(true); setMsg(null);
    try { await declineOffer(offer.id); } catch (e) { setMsg(errorText(e)); } finally { setOffer(null); setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H>You are online</H>
        <Chip text={offline ? 'Reconnecting' : 'Live'} color={offline ? t.warn : t.ok} />
      </View>
      {loc === 'foreground' ? <P mute>Set location to "Allow all the time" in your phone settings so rides keep arriving when your screen is off.</P> : null}
      {loc === 'denied' ? <Err>Location is off. Turn it on in your phone settings, or you will not receive rides.</Err> : null}
      {offline ? <P mute>No connection. We will keep trying.</P> : null}
      <Err>{msg}</Err>

      <MapBox height={190} markers={[
        ...(me ? [{ id: 'me', lat: me.lat, lng: me.lng, color: 'blue', title: 'You' }] : []),
        ...(offer ? [{ id: 'pickup', lat: offer.pickup_lat, lng: offer.pickup_lng, color: 'green', title: 'Pickup' }] : []),
      ]} />

      {offer ? (
        <Card tone="sand">
          <Chip text={`Respond in ${left}s`} color={left <= 10 ? t.bad : t.sea} />
          <P bold style={{ fontSize: 22 }}>{kes(offer.fare)}</P>
          <P mute>Pickup</P>
          <P bold>{offer.pickup_address || 'See map'}</P>
          <P mute>Drop-off</P>
          <P bold>{offer.dropoff_address || 'See map'}</P>
          <P mute>{`${offer.passengers} passenger${offer.passengers === 1 ? '' : 's'} · ${offer.service_type.toLowerCase()}`}</P>
          <Button title="Accept ride" onPress={accept} loading={busy} disabled={left === 0} />
          <Button title="Decline" kind="ghost" onPress={decline} disabled={busy} />
        </Card>
      ) : (
        <Card>
          <P bold>Waiting for ride requests</P>
          <P mute>Keep this screen open and your location on. Requests appear here with a 30 second timer.</P>
        </Card>
      )}

      <Button title="Today's earnings" kind="ghost" onPress={() => go('earnings')} />
      <Button title="End shift" kind="ghost" onPress={() => go('endshift')} />
    </Screen>
  );
}
