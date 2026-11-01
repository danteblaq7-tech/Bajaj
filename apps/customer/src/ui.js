import React from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { tx, useLang } from './i18n';

export const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`;

export function Screen({ children }) {
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </SafeAreaView>
  );
}
export function Header({ title, onBack }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}><Text style={{ color: t.sea, fontSize: 30 }}>‹</Text></Pressable> : null}
      <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 24, fontWeight: '800', flex: 1 }}>{tx(title)}</Text>
    </View>
  );
}
export function H({ children }) {
  const t = useTheme();
  return <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 26, fontWeight: '800' }}>{tx(children)}</Text>;
}
export function P({ children, mute, bold, style }) {
  const t = useTheme();
  return <Text style={[{ color: mute ? t.mute : t.ink, fontSize: 16, fontWeight: bold ? '700' : '400' }, style]}>{tx(children)}</Text>;
}
export function Card({ children, tone, onPress }) {
  const t = useTheme();
  const style = { backgroundColor: tone === 'sand' ? t.sandSoft : t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.line, padding: 16, gap: 8 };
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={style}>{children}</Pressable> : <View style={style}>{children}</View>;
}
export function Err({ children }) {
  const t = useTheme();
  return children ? <Text accessibilityRole="alert" style={{ color: t.bad, fontSize: 15, fontWeight: '600' }}>{tx(children)}</Text> : null;
}
export function Button({ title, onPress, kind = 'primary', loading, disabled, style }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.sea : kind === 'danger' ? t.bad : 'transparent';
  const fg = kind === 'primary' ? t.onSea : kind === 'danger' ? t.onBad : t.sea;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [{ minHeight: 54, borderRadius: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: bg,
        borderWidth: kind === 'ghost' ? 2 : 0, borderColor: t.sea, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontSize: 17, fontWeight: '700' }}>{tx(title)}</Text>}
    </Pressable>
  );
}
export function Field({ label, ...props }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ color: t.mute, fontSize: 14, fontWeight: '600' }}>{tx(label)}</Text> : null}
      <TextInput placeholderTextColor={t.mute}
        style={{ minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.ink, fontSize: 17, paddingHorizontal: 14 }} {...props} placeholder={tx(props.placeholder)} />
    </View>
  );
}
export function Chip({ text, color }) {
  const t = useTheme();
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: t.sandSoft, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 }}>
      <Text style={{ color: color || t.sea, fontWeight: '700', fontSize: 13 }}>{tx(text)}</Text>
    </View>
  );
}
// Pick one option. options: [{ value, label, disabled }]
export function Choice({ options, value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!o.disabled }} disabled={o.disabled} onPress={() => onChange(o.value)}
            style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, justifyContent: 'center', borderWidth: 2, borderColor: on ? t.sea : t.line,
              backgroundColor: on ? t.sea : t.surface, opacity: o.disabled ? 0.4 : 1 }}>
            <Text style={{ color: on ? t.onSea : t.ink, fontWeight: '700' }}>{tx(o.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export function Stars({ value, onChange }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`} onPress={() => onChange(n)} style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 34, color: n <= value ? t.sand : t.line }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Row({ left, right }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1 }}>{left}</View>{right}
    </View>
  );
}
export function Spinner() {
  const t = useTheme();
  return <ActivityIndicator color={t.sea} size="large" style={{ margin: 24 }} />;
}

export function LanguageToggle() {
  const { lang, setLang } = useLang();
  return <Choice options={[{ value: 'en', label: 'English' }, { value: 'sw', label: 'Kiswahili' }]} value={lang} onChange={setLang} />;
}
