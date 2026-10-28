import { useSyncExternalStore } from 'react';
import { vi } from './locales/vi';

export type Language = 'vi' | 'en';
const storageKey = 'rallyx.language';
function savedLanguage(): Language {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'vi'; } catch { return 'vi'; }
}
let language: Language = savedLanguage();
const listeners = new Set<() => void>();
export const getLanguage = () => language;
export const getLocale = () => language === 'vi' ? 'vi-VN' : 'en-US';

export function setLanguage(next: Language) {
  if (next !== 'vi' && next !== 'en') return;
  language = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Language switching also works without storage. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const sync = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) {
      language = savedLanguage();
      document.documentElement.lang = language;
      listeners.forEach(notify => notify());
    }
  };
  window.addEventListener('storage', sync);
  return () => { listeners.delete(listener); window.removeEventListener('storage', sync); };
}

export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, () => 'vi' as Language);
}

/** Translate interface copy only. Configured names and API values bypass this function. */
export function t(source: string | number | null | undefined, params: Record<string, string | number | null | undefined> = {}) {
  const key = source === null || source === undefined ? '' : String(source);
  let text = language === 'vi' ? vi[key] || key : key;
  // These messages contain server counts or configured names; translate only their fixed copy.
  if (language === 'vi' && !vi[key]) {
    const imported = /^Imported (\d+) tags\.$/.exec(key);
    const connection = /^(.*): (connection successful\.|connection unavailable\.)$/.exec(key);
    if (imported) text = t('Imported {0} tags.', { 0: imported[1] });
    else if (connection) text = `${connection[1]}: ${t(connection[2])}`;
  }
  return text.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(params, key) ? String(params[key] ?? '') : match);
}

export function LanguageSelector() {
  const current = useLanguage();
  return <label className="language-selector"><span>{current === 'vi' ? 'Ngôn ngữ' : 'Language'}</span><select aria-label="Ngôn ngữ / Language" value={current} onChange={event => setLanguage(event.target.value as Language)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>;
}
