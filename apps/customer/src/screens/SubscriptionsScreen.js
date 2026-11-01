import React, { useCallback, useEffect, useState } from 'react';
import { tx, locale } from '../i18n';
import { Alert } from 'react-native';
import { Screen, Header, P, Card, Button, Field, Err, Choice, Row, Chip, Spinner, kes } from '../ui';
import { useTheme } from '../theme';
import { getPlans, mySubs, createSub, cancelSub, errorText } from '../api';

const LABELS = { EMPLOYEE: 'Employee', SCHOOL: 'School pupil', HOTEL: 'Hotel guest' };
const CODE_HINT = { EMPLOYEE: 'Company code from your HR team', SCHOOL: 'School code from your school', HOTEL: 'Hotel code (or scan the QR at reception)' };
const ID_HINT = { EMPLOYEE: 'Employee ID', SCHOOL: 'Student ID', HOTEL: 'Room or booking number' };

export default function SubscriptionsScreen({ nav }) {
  const t = useTheme();
  const [plans, setPlans] = useState(null);
  const [subs, setSubs] = useState([]);
  const [type, setType] = useState(null);
  const [code, setCode] = useState('');
  const [member, setMember] = useState('');
  const [morning, setMorning] = useState('07:00');
  const [evening, setEvening] = useState('17:00');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try { const [p, s] = await Promise.all([getPlans(), mySubs()]); setPlans(p.plans); setSubs(s.subscriptions); } catch (e) { setErr(errorText(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await createSub({ plan_type: type, organization_code: code.trim(), schedule: { morning, evening }, ...(member.trim() ? { member_id: member.trim() } : {}) });
      nav.replace('pay', { purpose: 'INVOICE', targetId: r.invoice.id, amount: r.invoice.amount, title: 'Pay first month', after: () => nav.reset() });
    } catch (e) { setErr(errorText(e)); setBusy(false); }
  };
  const cancel = (s) => Alert.alert(tx('Cancel subscription?'), tx('It stops renewing and unpaid invoices are voided.'), [
    { text: tx('Keep it'), style: 'cancel' },
    { text: tx('Cancel'), style: 'destructive', onPress: async () => { try { await cancelSub(s.id); await load(); } catch (e) { setErr(errorText(e)); } } },
  ]);
  const plan = plans && plans.find((p) => p.type === type);

  return (
    <Screen>
      <Header title="Monthly plans" onBack={nav.pop} />
      <Err>{err}</Err>
      {!plans && !err ? <Spinner /> : null}

      {subs.filter((s) => s.status !== 'CANCELLED').map((s) => {
        const unpaid = (s.invoices || []).find((i) => i.status === 'UNPAID');
        return (
          <Card key={s.id} tone="sand">
            <Row left={<P bold>{LABELS[s.plan_type]} plan</P>} right={<Chip text={s.status.toLowerCase()} color={s.status === 'ACTIVE' ? t.ok : t.warn} />} />
            <P mute>{s.organization_code} · {kes(s.monthly_fee)} a month</P>
            {s.end_date ? <P mute>Paid until {new Date(s.end_date).toLocaleDateString(locale())}</P> : null}
            {unpaid ? <Button title={`Pay ${kes(unpaid.amount)}`} onPress={() => nav.push('pay', { purpose: 'INVOICE', targetId: unpaid.id, amount: unpaid.amount, title: 'Pay subscription', after: () => nav.reset() })} /> : null}
            {s.status === 'ACTIVE' || s.status === 'GRACE' ? <Button title="Book a ride with this plan" kind="ghost" onPress={() => nav.replace('ride')} /> : null}
            <Button title="Cancel plan" kind="ghost" onPress={() => cancel(s)} />
          </Card>
        );
      })}

      <P bold style={{ fontSize: 18 }}>Start a new plan</P>
      <Choice value={type} onChange={setType} options={(plans || []).map((p) => ({ value: p.type, label: LABELS[p.type] }))} />
      {type ? (
        <Card>
          <P mute>{`From ${kes(plan.base_fee)} a month. Your organization may have its own rate.`}</P>
          <Field label={CODE_HINT[type]} value={code} onChangeText={setCode} autoCapitalize="characters" />
          <Field label={ID_HINT[type]} value={member} onChangeText={setMember} />
          <P mute>Morning pickup</P>
          <Choice value={morning} onChange={setMorning} options={['06:30', '07:00', '07:30'].map((v) => ({ value: v, label: v }))} />
          <P mute>Evening pickup</P>
          <Choice value={evening} onChange={setEvening} options={['16:00', '17:00', '18:00'].map((v) => ({ value: v, label: v }))} />
          <Button title="Continue to payment" onPress={submit} loading={busy} disabled={code.trim().length < 3} />
        </Card>
      ) : null}
    </Screen>
  );
}
