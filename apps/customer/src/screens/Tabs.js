import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, H, P, Card, Button, Field, Err, Chip, Choice, Row, Spinner, LanguageToggle, kes } from '../ui';
import { locale } from '../i18n';
import { useTheme } from '../theme';
import { myBookings, myParcels, getWallet, updateMe, errorText } from '../api';

const ACTIVE = ['PAID', 'ASSIGNED', 'IN_PROGRESS'];
const TYPE = { RIDE: 'Ride', TOUR: 'Tour', SUBSCRIPTION: 'Subscription ride' };
const when = (iso) => new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function HomeTab({ nav, user }) {
  const t = useTheme();
  const [active, setActive] = useState(null);
  useEffect(() => { myBookings().then((r) => setActive(r.bookings.find((b) => ACTIVE.includes(b.status)) || null)).catch(() => {}); }, []);
  const tiles = [
    ['Book a ride', 'Fixed price, up front', 'ride'],
    ['Mini tours', 'Creek, ruins and beaches', 'tours'],
    ['Send a parcel', 'Same-day delivery', 'parcel'],
    ['Monthly plans', 'Work, school and hotels', 'subs'],
  ];
  return (
    <Screen>
      <H>Jambo{user && user.name ? `, ${user.name.split(' ')[0]}` : ''}</H>
      <P mute>Where are we heading today?</P>
      {active ? (
        <Card tone="sand" onPress={() => nav.push('track', { id: active.id })}>
          <Chip text="Ride in progress" color={t.ok} />
          <P bold>{active.dropoff_address}</P>
          <P mute>Tap to track</P>
        </Card>
      ) : null}
      {tiles.map(([title, sub, screen]) => (
        <Card key={screen} onPress={() => nav.push(screen)}>
          <P bold style={{ fontSize: 19 }}>{title}</P>
          <P mute>{sub}</P>
        </Card>
      ))}
    </Screen>
  );
}

function ActivityTab({ nav }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([myBookings(), myParcels()]).then(([b, p]) => setData({ b: b.bookings, p: p.parcels })).catch((e) => setErr(errorText(e)));
  }, []);
  return (
    <Screen>
      <H>Activity</H>
      <Err>{err}</Err>
      {!data && !err ? <Spinner /> : null}
      {data && !data.b.length && !data.p.length ? <P mute>Nothing yet. Your rides and parcels will show up here.</P> : null}
      {data ? data.b.map((b) => (
        <Card key={b.id} onPress={() => nav.push('track', { id: b.id })}>
          <Row left={<P bold>{TYPE[b.service_type]}</P>} right={<Chip text={b.status.replace('_', ' ').toLowerCase()} color={b.status === 'COMPLETED' ? t.ok : b.status === 'CANCELLED' ? t.bad : t.sea} />} />
          <P mute>{b.pickup_address} to {b.dropoff_address}</P>
          <P mute>{`${b.scheduled_at ? '⏰ ' : ''}${when(b.scheduled_at || b.created_at)} · ${b.fare > 0 ? kes(b.fare) : 'Included'}`}</P>
        </Card>
      )) : null}
      {data && data.p.length ? <P bold style={{ fontSize: 18 }}>Parcels</P> : null}
      {data ? data.p.map((p) => (
        <Card key={p.id} onPress={() => nav.push('parcelTrack', { trackingId: p.tracking_id, id: p.id, fare: p.fare })}>
          <Row left={<P bold>{p.tracking_id}</P>} right={<Chip text={p.status.replace('_', ' ').toLowerCase()} />} />
          <P mute>To {p.recipient_name} · {kes(p.fare)}</P>
        </Card>
      )) : null}
    </Screen>
  );
}

function WalletTab({ nav }) {
  const [bal, setBal] = useState(null);
  const [amount, setAmount] = useState('500');
  const [err, setErr] = useState(null);
  useEffect(() => { getWallet().then((r) => setBal(r.wallet.balance)).catch((e) => setErr(errorText(e))); }, []);
  const n = Number(amount);
  const valid = n >= 50 && n <= 70000;
  return (
    <Screen>
      <H>Wallet</H>
      <Card tone="sand"><P mute>Balance</P><P bold style={{ fontSize: 34 }}>{bal == null ? '...' : kes(bal)}</P></Card>
      <Err>{err}</Err>
      <P>Top up with M-Pesa to pay for rides instantly. Refunds from cancelled rides land here.</P>
      <Choice value={amount} onChange={setAmount} options={['200', '500', '1000', '2000'].map((v) => ({ value: v, label: kes(v) }))} />
      <Field label="Or enter an amount" value={amount} onChangeText={setAmount} keyboardType="number-pad" />
      <Button title={`Top up ${valid ? kes(n) : ''}`} disabled={!valid} onPress={() => nav.push('pay', { purpose: 'WALLET_TOPUP', amount: n, title: 'Top up wallet', after: () => nav.reset() })} />
      {!valid ? <P mute>Enter an amount from KES 50 to KES 70,000.</P> : null}
    </Screen>
  );
}

function AccountTab({ user, refreshUser, logout }) {
  const [contact, setContact] = useState(user && user.emergency_contact_phone ? '0' + user.emergency_contact_phone.slice(3) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try { await updateMe({ emergency_contact_phone: contact }); await refreshUser(); setMsg('Saved.'); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <H>Account</H>
      <Card><P bold>{user ? user.name : ''}</P><P mute>{user ? '0' + user.phone.slice(3) : ''}</P></Card>
      <Card>
        <P bold>Emergency contact</P>
        <P mute>We text this person when your trip starts, so someone knows you are on your way.</P>
        <Field value={contact} onChangeText={setContact} keyboardType="phone-pad" placeholder="0712 345 678" />
        <Err>{err}</Err>
        {msg ? <P bold>{msg}</P> : null}
        <Button title="Save contact" kind="ghost" onPress={save} loading={busy} disabled={contact.length < 9} />
      </Card>
      <Card><P bold>Language</P><LanguageToggle /></Card>
      <Button title="Sign out" kind="ghost" onPress={logout} />
    </Screen>
  );
}

const TABS = [['home', 'Home'], ['activity', 'Activity'], ['wallet', 'Wallet'], ['account', 'Account']];

export default function Tabs({ tab, setTab, ...props }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const Body = { home: HomeTab, activity: ActivityTab, wallet: WalletTab, account: AccountTab }[tab];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}><Body {...props} /></View>
      <View style={{ flexDirection: 'row', backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line, paddingBottom: insets.bottom }}>
        {TABS.map(([id, label]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: tab === id ? t.sea : t.mute, fontWeight: tab === id ? '800' : '600', fontSize: 14 }}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
