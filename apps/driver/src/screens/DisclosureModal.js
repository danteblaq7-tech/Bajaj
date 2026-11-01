import React from 'react';
import { Modal } from 'react-native';
import { Screen, H, P, Card, Button } from '../ui';

// Shown once, before location is ever requested (required by Google Play for background location).
export default function DisclosureModal({ visible, onAccept }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => {}}>
      <Screen>
        <H>Location while you drive</H>
        <Card>
          <P>Pwani Ride Driver collects your location, even when the app is closed or not in use, while you are online or on a trip.</P>
          <P>We use it to match you with nearby ride requests, show customers where you are, and give Operations safety information.</P>
          <P mute>Your location is not collected while you are offline. You can go offline at any time and change this in your phone settings.</P>
        </Card>
        <Button title="I understand" onPress={onAccept} />
      </Screen>
    </Modal>
  );
}
