import React, { useState } from 'react';
import { View } from 'react-native';
import { Screen, H, P, Field, Button, Err, LanguageToggle } from '../ui';
import { login, saveTokens, errorText } from '../api';

export default function LoginScreen({ onLoggedIn }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await login(phone, pin);
      await saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
      onLoggedIn();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <View style={{ height: 40 }} />
      <H>Pwani Ride Driver</H>
      <P mute>Sign in with your phone number and PIN.</P>
      <LanguageToggle />
      <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0712 345 678" autoComplete="tel" />
      <Field label="PIN" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder="4 to 6 digits" />
      <Err>{err}</Err>
      <Button title="Sign in" onPress={submit} loading={busy} disabled={!phone || pin.length < 4} />
    </Screen>
  );
}
