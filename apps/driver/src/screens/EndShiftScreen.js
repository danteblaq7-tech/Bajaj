import React, { useState } from 'react';
import { Screen, H, P, Field, Button, Err } from '../ui';
import { endShift, errorText } from '../api';

export default function EndShiftScreen({ go, refresh }) {
  const [fuel, setFuel] = useState('');
  const [mileage, setMileage] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await endShift({ end_fuel: Number(fuel), mileage: Number(mileage), ...(note.trim() ? { incident_note: note.trim() } : {}) });
      go('home');
      await refresh();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const valid = fuel !== '' && mileage !== '' && !Number.isNaN(Number(fuel)) && !Number.isNaN(Number(mileage));

  return (
    <Screen>
      <H>End shift</H>
      <P mute>Post-shift report. This goes to Operations.</P>
      <Field label="Fuel left (litres)" value={fuel} onChangeText={setFuel} keyboardType="decimal-pad" />
      <Field label="Mileage for the shift (km)" value={mileage} onChangeText={setMileage} keyboardType="decimal-pad" />
      <Field label="Incidents or problems (optional)" value={note} onChangeText={setNote} multiline style={{ minHeight: 90, textAlignVertical: 'top', paddingTop: 12 }} />
      <Err>{err}</Err>
      <Button title="Submit and go offline" onPress={submit} loading={busy} disabled={!valid} />
      <Button title="Back" kind="ghost" onPress={() => go('home')} />
    </Screen>
  );
}
