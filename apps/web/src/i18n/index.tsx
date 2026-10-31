import React, { createContext, useContext, useState, useEffect } from 'react';
import type { TranslationKey } from './en';

export type Locale = 'en' | 'sw';

// Each client downloads one language: this is what keeps the flow under its budget (D35).
type Dictionary = Record<TranslationKey, string>;
const loaded: Partial<Record<Locale, Dictionary>> = {};

export async function loadLocale(locale: Locale): Promise<void> {
  if (loaded[locale]) return;
  loaded[locale] =
    locale === 'sw' ? (await import('./sw')).sw : (await import('./en')).en;
}

export function savedLocale(): Locale {
  try {
    const saved = localStorage.getItem('vt_language');
    if (saved === 'sw' || saved === 'en') return saved;
  } catch {
    // ignore
  }
  return 'en';
}

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(savedLocale);

  const setLocale = (newLocale: Locale) => {
    // Stays on the current language if the other one cannot be fetched.
    void loadLocale(newLocale).then(() => {
      setLocaleState(newLocale);
      try {
        localStorage.setItem('vt_language', newLocale);
      } catch {
        // ignore
      }
    }, () => {});
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = (key: TranslationKey, params?: Record<string, string | number>): string => {
    let text: string = loaded[locale]?.[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([paramKey, val]) => {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(val));
      });
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
