import React, { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Screen, Header, P, Card, Button, Field, Err, Choice, Chip, kes } from '../ui';
import { useTheme } from '../theme';
import { pay, receipt, getWallet, getMethods, errorText } from '../api';

// params: { purpose: 'BOOKING'|'PARCEL'|'INVOICE'|'WALLET_TOPUP', targetId, amount, title, after() }
export default function PayScreen({ nav, params, user }) {
  const t = useTheme();
  const topup = params.purpose === 'WALLET_TOPUP';
  const [method, setMethod] = useState('MPESA');
  const [phone, setPhone] = useState(user && user.phone ? '0' + user.phone.slice(3) : '');
  const [balance, setBalance] = useState(null);
  const [cardOk, setCardOk] = useState(false);
  const [waiting, setWaiting] = useState(null); // null | 'MPESA' | 'CARD'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!topup) getWallet().then((r) => setBalance(r.wallet.balance)).catch(() => {});
    getMethods().then((m) => setCardOk(!!m.card)).catch(() => {});
  }, []);

  // Poll the payment until the server says it succeeded or failed (about 2 minutes for M-Pesa, longer for card).
  const watch = async (paymentId, kind) => {
    setWaiting(kind);
    const tries = kind === 'CARD' ? 120 : 48;
    for (let i = 0; i < tries && alive.current; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const r = await receipt(paymentId);
        if (r.status === 'SUCCESS') { if (alive.current) params.after(); return; }
        if (r.status === 'FAILED') { setErr('The payment was not completed. You can try again.'); break; }
      } catch (e) { /* keep waiting through short network drops */ }
    }
    if (alive.current) { setWaiting(null); setBusy(false); setErr((p) => p || 'We did not get a confirmation. If M-Pesa took your money, it will show in your wallet or booking shortly. Otherwise try again.'); }
  };

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await pay({ ...params, method, phone: method === 'MPESA' ? phone : undefined });
      if (r.status === 'SUCCESS') { params.after(); return; }
      const w = watch(r.payment_id, method === 'CARD' ? 'CARD' : 'MPESA');
      if (r.checkout_url) { try { await WebBrowser.openBrowserAsync(r.checkout_url); } catch (e) { /* the payment page can also be reopened by retrying */ } }
      await w;
    } catch (e) {
      setErr(errorText(e) + (e.details && e.details.alternative === 'WALLET' ? ' You can pay from your wallet instead.' : ''));
      setBusy(false);
    }
  };

  const options = [{ value: 'MPESA', label: 'M-Pesa' }];
  if (cardOk) options.push({ value: 'CARD', label: 'Card' });
  if (!topup) options.push({ value: 'WALLET', label: `Wallet${balance != null ? ' · ' + kes(balance) : ''}` });
  const short = !topup && method === 'WALLET' && balance != null && balance < params.amount;
  const label = method === 'CARD' ? 'Pay by card' : method === 'WALLET' ? `Pay ${kes(params.amount)} from wallet` : 'Send M-Pesa prompt';

  return (
    <Screen>
      <Header title={params.title || 'Payment'} onBack={waiting ? undefined : nav.pop} />
      <Card tone="sand"><P mute>Amount</P><P bold style={{ fontSize: 32 }}>{kes(params.amount)}</P></Card>
      {waiting ? (
        <Card>
          <Chip text={waiting === 'CARD' ? 'Waiting for your card payment' : 'Waiting for M-Pesa'} color={t.warn} />
          <P bold>{waiting === 'CARD' ? 'Finish in the payment page' : 'Check your phone'}</P>
          <P mute>{waiting === 'CARD' ? 'Complete the payment in the secure page, then come back here. This screen updates by itself.' : 'Enter your M-Pesa PIN to approve the payment. This screen updates by itself.'}</P>
        </Card>
      ) : (<>
        {options.length > 1 ? <Card><P mute>Pay with</P><Choice options={options} value={method} onChange={setMethod} /></Card> : null}
        {method === 'MPESA' ? <Field label="M-Pesa number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /> : null}
        {short ? <Err>Your wallet balance is too low for this payment.</Err> : null}
        <Err>{err}</Err>
        <Button title={label} onPress={start} loading={busy} disabled={short || (method === 'MPESA' && phone.length < 9)} />
      </>)}
    </Screen>
  );
}
