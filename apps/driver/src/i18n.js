import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { getLocales } from 'expo-localization';
import { SW, PATTERNS } from './sw';

let current = 'en';
export function translate(lang, text) {
  if (lang !== 'sw' || typeof text !== 'string') return text;
  if (SW[text] !== undefined) return SW[text];
  for (const [re, out] of PATTERNS) if (re.test(text)) return text.replace(re, out);
  return text;
}
// Translate a string in the current language (anything that is not a string passes through untouched).
export const tx = (s) => (typeof s === 'string' ? translate(current, s) : s);
export const locale = () => (current === 'sw' ? 'sw-KE' : 'en-KE');

const Ctx = createContext({ lang: 'en', setLang: () => {} });
export const useLang = () => useContext(Ctx);

// Starts in the saved language, otherwise the phone's language (Swahili if the phone is set to it).
// Changing language re-creates the screens (key={lang}) so every label updates at once.
export function LangProvider({ children }) {
  const [lang, setLangState] = useState(null);
  useEffect(() => {
    (async () => {
      let l = null;
      try { l = await SecureStore.getItemAsync('lang'); } catch (e) { /* ignore */ }
      if (l !== 'en' && l !== 'sw') { try { const c = getLocales()[0]; l = c && c.languageCode === 'sw' ? 'sw' : 'en'; } catch (e) { l = 'en'; } }
      setLangState(l);
    })();
  }, []);
  const setLang = useCallback(async (l) => { try { await SecureStore.setItemAsync('lang', l); } catch (e) { /* ignore */ } setLangState(l); }, []);
  const value = useMemo(() => ({ lang: lang || 'en', setLang }), [lang, setLang]);
  if (!lang) return null;
  current = lang;
  return <Ctx.Provider value={value}><React.Fragment key={lang}>{children}</React.Fragment></Ctx.Provider>;
}
