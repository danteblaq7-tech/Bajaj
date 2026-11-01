import React, { useState } from 'react';
import { Screen, Header, P, Card, Field, Button, Err } from '../ui';
import { PRESETS, currentPlace, searchPlaces } from '../places';

// params: { title, onPick(place), allowCurrent }
export default function PlaceScreen({ nav, params }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const pick = (p) => { params.onPick(p); nav.pop(); };

  const useCurrent = async () => { setBusy(true); setErr(null); try { pick(await currentPlace()); } catch (e) { setErr(e.message); setBusy(false); } };
  const search = async () => {
    setBusy(true); setErr(null);
    try { const r = await searchPlaces(q.trim()); setResults(r); if (!r.length) setErr('No match found. Try a nearby landmark or pick from the list.'); }
    catch (e) { setErr('Search is unavailable right now. Pick from the list instead.'); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <Header title={params.title} onBack={nav.pop} />
      {params.allowCurrent ? <Button title="Use my current location" onPress={useCurrent} loading={busy} /> : null}
      <Button title="Pick on map" kind={params.allowCurrent ? 'ghost' : 'primary'} onPress={() => nav.push('mapPick', { title: params.title, onPick: (p) => { params.onPick(p); nav.pop(); } })} />
      <Field value={q} onChangeText={setQ} placeholder="Search a place or landmark" returnKeyType="search" onSubmitEditing={search} />
      <Button title="Search" kind="ghost" onPress={search} disabled={busy || q.trim().length < 3} />
      <Err>{err}</Err>
      {results.map((r, i) => <Card key={i} onPress={() => pick(r)}><P bold>{r.address}</P><P mute>Search result</P></Card>)}
      <P mute>Popular stops</P>
      {PRESETS.map((p) => <Card key={p.address} onPress={() => pick(p)}><P bold>{p.address}</P></Card>)}
    </Screen>
  );
}
