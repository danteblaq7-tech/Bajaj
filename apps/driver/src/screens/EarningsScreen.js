import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Screen, H, P, Card, Button, Err, Chip } from '../ui';
import { useTheme } from '../theme';
import { locale } from '../i18n';
import { earnings, myPayouts, errorText } from '../api';

const kes = (n) => `KES ${Number(n).toLocaleString('en-KE')}`;
const day = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

export default function EarningsScreen({ go }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    earnings().then(setData).catch((e) => setErr(errorText(e)));
    myPayouts().then((r) => setPayouts(r.payouts)).catch(() => {});
  }, []);

  return (
    <Screen>
      <H>Earnings</H>
      <Err>{err}</Err>
      {!data && !err ? <ActivityIndicator color={t.sea} size="large" /> : null}
      {data ? (
        <>
          <Card tone="sand"><P mute>Today</P><P bold style={{ fontSize: 30 }}>{kes(data.today)}</P></Card>
          <Card><P mute>This week</P><P bold style={{ fontSize: 22 }}>{kes(data.week)}</P></Card>
          <Card><P mute>This month</P><P bold style={{ fontSize: 22 }}>{kes(data.month)}</P></Card>
          <Card><P mute>All time</P><P bold style={{ fontSize: 22 }}>{kes(data.total)}</P></Card>
          <P mute>{`After the ${Math.round(data.commission_rate * 100)}% platform commission. Payouts are handled by Operations.`}</P>
        </>
      ) : null}
      <P bold style={{ fontSize: 18 }}>Payouts</P>
      {!payouts.length ? <P mute>No payouts yet. They are created every Monday for the week before.</P> : null}
      {payouts.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <P bold>{kes(p.net)}</P>
            <Chip text={p.status.toLowerCase()} color={p.status === 'PAID' ? t.ok : p.status === 'FAILED' ? t.bad : t.sea} />
          </View>
          <P mute>{day(p.period_start)} - {day(p.period_end)} · {p.trips} trips{p.receipt_ref ? ` · ${p.receipt_ref}` : ''}</P>
        </Card>
      ))}
      <Button title="Back" kind="ghost" onPress={() => go('home')} />
    </Screen>
  );
}
