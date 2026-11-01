import React, { useState } from 'react';
import { View, Modal, Text } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Screen, H, P, Card, Button, Field, Err, Chip, LanguageToggle } from '../ui';
import { useTheme } from '../theme';
import { takePhoto } from '../photo';
import { startShift, uploadPhoto, errorText } from '../api';

const ITEMS = [
  ['tires_photo', 'Tires', 'Photo of the tires'],
  ['ac_photo', 'Air conditioning', 'Photo showing the AC working'],
  ['cleanliness_photo', 'Cleanliness', 'Photo of the passenger seat area'],
  ['camera_photo', 'Camera test', 'Test photo from the in-car camera view'],
];

export default function ShiftStartScreen({ refresh }) {
  const t = useTheme();
  const [photos, setPhotos] = useState({});
  const [selfie, setSelfie] = useState(null);
  const [fuel, setFuel] = useState('');
  const [qr, setQr] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [perm, askPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const snap = async (key, front) => {
    setErr(null);
    try {
      const uri = await takePhoto({ front });
      if (uri) { if (key === 'selfie') setSelfie(uri); else setPhotos((p) => ({ ...p, [key]: uri })); }
    } catch (e) { setErr(e.message); }
  };
  const openScanner = async () => {
    if (!perm || !perm.granted) { const r = await askPerm(); if (!r.granted) { setErr('Camera permission is needed to scan the QR code.'); return; } }
    setScanning(true);
  };

  const ready = ITEMS.every(([k]) => photos[k]) && selfie && qr && fuel !== '' && !Number.isNaN(Number(fuel));
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const checklist = { fuel_liters: Number(fuel) };
      for (const [k] of ITEMS) checklist[k] = await uploadPhoto(photos[k]);
      await startShift({ vehicle_qr: qr, selfie_url: await uploadPhoto(selfie), checklist });
      await refresh();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <H>Start your shift</H>
      <P mute>Complete every check, then scan the QR code on the tuktuk dashboard.</P>
      <LanguageToggle />

      {ITEMS.map(([key, title, hint]) => (
        <Card key={key}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <P bold>{title}</P>
            <Chip text={photos[key] ? 'Done' : 'Photo needed'} color={photos[key] ? t.ok : t.warn} />
          </View>
          <P mute>{hint}</P>
          <Button title={photos[key] ? 'Retake photo' : 'Take photo'} kind="ghost" onPress={() => snap(key, false)} />
        </Card>
      ))}

      <Card>
        <P bold>Fuel level</P>
        <Field label="Litres in the tank" value={fuel} onChangeText={setFuel} keyboardType="decimal-pad" placeholder="e.g. 6.5" />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <P bold>Your selfie</P>
          <Chip text={selfie ? 'Done' : 'Needed'} color={selfie ? t.ok : t.warn} />
        </View>
        <Button title={selfie ? 'Retake selfie' : 'Take selfie'} kind="ghost" onPress={() => snap('selfie', true)} />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <P bold>Vehicle QR code</P>
          <Chip text={qr ? 'Scanned' : 'Needed'} color={qr ? t.ok : t.warn} />
        </View>
        <Button title={qr ? 'Scan again' : 'Scan QR code'} kind="ghost" onPress={openScanner} />
      </Card>

      <Err>{err}</Err>
      <Button title="Go online" onPress={submit} loading={busy} disabled={!ready} />

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => { if (data) { setQr(data.trim()); setScanning(false); } }}
          />
          <View style={{ position: 'absolute', bottom: 40, left: 16, right: 16 }}>
            <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 12, fontSize: 16 }}>Point the camera at the QR code on the dashboard</Text>
            <Button title="Cancel" kind="ghost" onPress={() => setScanning(false)} style={{ backgroundColor: '#fff' }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
