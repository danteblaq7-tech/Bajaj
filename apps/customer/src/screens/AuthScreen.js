import React, { useState } from 'react';
import { View } from 'react-native';
import { Screen, H, P, Field, Button, Err, LanguageToggle } from '../ui';
import { useLang } from '../i18n';
import { otpSend, register, otpVerify, saveTokens, errorText } from '../api';

// One flow for sign in and sign up: phone, (name if new), SMS code.
export default function AuthScreen({ onDone }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { lang } = useLang();

  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const sendCode = () => run(async () => {
    try { await otpSend(phone); setStep('code'); } catch (e) {
      if (e.status === 404) setStep('name');        // new customer: ask for a name first
      else if (e.status === 429) { setStep('code'); throw e; } // code was just sent
      else throw e;
    }
  });
  const signUp = () => run(async () => { await register(phone, name, lang); setStep('code'); });
  const verify = () => run(async () => {
    const r = await otpVerify(phone, code);
    await saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    onDone();
  });

  return (
    <Screen>
      <View style={{ height: 40 }} />
      <H>Pwani Ride</H>
      <P mute>Safe, fixed-price tuktuk rides along the coast.</P>
      <LanguageToggle />
      {step === 'phone' ? (<>
        <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0712 345 678" autoComplete="tel" />
        <Err>{err}</Err>
        <Button title="Continue" onPress={sendCode} loading={busy} disabled={phone.length < 9} />
      </>) : null}
      {step === 'name' ? (<>
        <P>Welcome! What should we call you?</P>
        <Field label="Your name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Err>{err}</Err>
        <Button title="Create account" onPress={signUp} loading={busy} disabled={name.trim().length < 2} />
      </>) : null}
      {step === 'code' ? (<>
        <P>{`We sent a code to ${phone}.`}</P>
        <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} />
        <Err>{err}</Err>
        <Button title="Verify and sign in" onPress={verify} loading={busy} disabled={code.length < 4} />
        <Button title="Send a new code" kind="ghost" onPress={sendCode} disabled={busy} />
      </>) : null}
    </Screen>
  );
}
