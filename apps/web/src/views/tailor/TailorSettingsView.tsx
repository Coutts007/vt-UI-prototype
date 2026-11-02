import React, { lazy, Suspense, useState } from 'react';
import { LogOut } from 'lucide-react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { APP_VERSION } from '../../appVersion';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';
import { UserAccount } from '../../types/api';
import {
  ALL_SITES,
  applySunlight,
  readSunlight,
  Card,
  chipClass,
  EasePreset,
  GARMENT_SITES,
  GARMENTS,
  GarmentType,
  hintClass,
  inputClass,
  labelClass,
  SiteCode,
  Title,
  toMm,
  toUnit,
  Unit,
  useLoad,
} from './common';
import { TailorKey, useTailorText } from './tailorText';
import type { TranslationKey } from '../../i18n/en';

// Loaded only when the directory is on, so a switched-off build carries none of it (D27).
const Listing = __VT_DIRECTORY__
  ? lazy(() => import('./DirectoryListingPanel').then((m) => ({ default: m.DirectoryListingPanel })))
  : null;

const NAME_DEFAULT_KEY = 'vt_sheet_include_name';
const presetKey = (garment: GarmentType, site: SiteCode) => `${garment}:${site}`;

export const TailorSettingsView: React.FC<{
  currentUser: UserAccount;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}> = ({ currentUser, onNavigate, onLogout }) => {
  const tx = useTailorText();
  const { t, locale, setLocale } = useI18n();
  const [unit, setUnit] = useState<Unit>(currentUser.unit_pref ?? 'cm');
  const [business, setBusiness] = useState(currentUser.business_name ?? '');
  const [phone, setPhone] = useState(currentUser.phone ?? '');
  const [area, setArea] = useState(currentUser.area ?? '');
  const [status, setStatus] = useState<TailorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<TailorKey | null>(null);
  const [garment, setGarment] = useState<GarmentType>('shirt');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [presetStatus, setPresetStatus] = useState<TailorKey | null>(null);
  const [sunlight, setSunlight] = useState(readSunlight);
  const [nameDefault, setNameDefault] = useState(() => {
    try {
      return localStorage.getItem(NAME_DEFAULT_KEY) === '1';
    } catch {
      return false;
    }
  });

  const presets = useLoad(() => apiClient.get('/me/ease-presets'), []);
  const settings = useLoad(() => apiClient.get('/settings/public'), []);
  const saved = (g: GarmentType, s: SiteCode) =>
    presets.data?.find((row) => row.garment_type === g && row.site_code === s)?.ease_mm;

  const saveSettings = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const user = await apiClient.patch('/me', {
        body: { business_name: business, phone, area, unit_pref: unit, locale },
      });
      sessionStorage.setItem('vt_session_user', JSON.stringify(user));
      setStatus('saved');
    } catch (problem) {
      setStatus(problem instanceof ApiError && problem.code === 'validation_failed' ? 'phoneInvalid' : 'saveFailed');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setPasswordStatus(null);
    try {
      await apiClient.post('/me/password', { body: { current_password: current, new_password: next } });
      setPasswordStatus('passwordChanged');
      onLogout();
    } catch (problem) {
      setPasswordStatus(problem instanceof ApiError && problem.code === 'invalid_credentials' ? 'passwordWrong' : 'saveFailed');
    }
  };

  const savePresets = async () => {
    const rows: EasePreset[] = [];
    for (const g of GARMENTS) {
      for (const s of ALL_SITES) {
        const key = presetKey(g, s);
        const text = typed[key];
        const value = text === undefined ? saved(g, s) : text.trim() === '' ? undefined : toMm(Number(text), unit);
        if (value === undefined) continue;
        if (!Number.isFinite(value) || value < 0 || value > 300) {
          setPresetStatus('easeRange');
          return;
        }
        rows.push({ garment_type: g, site_code: s, ease_mm: value });
      }
    }
    setPresetStatus(null);
    try {
      presets.setData(await apiClient.put('/me/ease-presets', { body: rows }));
      setTyped({});
      setPresetStatus('saved');
    } catch {
      setPresetStatus('saveFailed');
    }
  };

  const toggleNameDefault = (value: boolean) => {
    setNameDefault(value);
    try {
      localStorage.setItem(NAME_DEFAULT_KEY, value ? '1' : '0');
    } catch {
      // A preference only: the sheet still asks each time.
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl mx-auto">
      <Title>{tx('settingsTitle')}</Title>
      <Card>
        <div>
          <span className={labelClass}>{tx('languageLabel')}</span>
          <div className="flex gap-2">
            <button type="button" aria-pressed={locale === 'en'} className={chipClass(locale === 'en')} onClick={() => setLocale('en')}>English</button>
            <button type="button" aria-pressed={locale === 'sw'} className={chipClass(locale === 'sw')} onClick={() => setLocale('sw')}>Kiswahili</button>
          </div>
        </div>
        <div>
          <span className={labelClass}>{tx('unitsLabel')}</span>
          <div className="flex gap-2">
            <button type="button" aria-pressed={unit === 'cm'} className={chipClass(unit === 'cm')} onClick={() => setUnit('cm')}>{tx('unitCm')}</button>
            <button type="button" aria-pressed={unit === 'in'} className={chipClass(unit === 'in')} onClick={() => setUnit('in')}>{tx('unitIn')}</button>
          </div>
        </div>
        <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
          <input
            type="checkbox"
            className="w-5 h-5"
            checked={sunlight}
            onChange={(e) => {
              setSunlight(e.target.checked);
              applySunlight(e.target.checked, true);
            }}
          />
          {tx('sunlightMode')}
        </label>
        <div>
          <label htmlFor="set-business" className={labelClass}>{tx('businessLabel')}</label>
          <input id="set-business" maxLength={120} value={business} onChange={(e) => setBusiness(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="set-phone" className={labelClass}>{tx('phoneLabel')}</label>
          <input id="set-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="set-area" className={labelClass}>{tx('areaLabel')}</label>
          <input id="set-area" maxLength={120} value={area} onChange={(e) => setArea(e.target.value)} className={inputClass} />
        </div>
        <Button loading={busy} onClick={saveSettings}>{tx('saveSettings')}</Button>
        {status && <p role="status" className="text-sm">{tx(status)}</p>}
      </Card>

      <Card title={tx('presetsTitle')}>
        <p className={hintClass}>{tx('presetsHint', { unit })}</p>
        <div>
          <label htmlFor="preset-garment" className={labelClass}>{tx('garmentLabel')}</label>
          <select id="preset-garment" value={garment} onChange={(e) => setGarment(e.target.value as GarmentType)} className={inputClass}>
            {GARMENTS.map((name) => <option key={name} value={name}>{tx(`garment_${name}` as TailorKey)}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {GARMENT_SITES[garment].map((site) => {
            const key = presetKey(garment, site);
            const stored = saved(garment, site);
            return (
              <div key={key}>
                <label htmlFor={`preset-${key}`} className={labelClass}>{t(`site_${site}` as TranslationKey)}</label>
                <input
                  id={`preset-${key}`}
                  inputMode="decimal"
                  value={typed[key] ?? (stored === undefined ? '' : String(toUnit(stored, unit)))}
                  onChange={(e) => setTyped((all) => ({ ...all, [key]: e.target.value }))}
                  className={inputClass}
                />
              </div>
            );
          })}
        </div>
        <Button variant="outline" onClick={savePresets}>{tx('presetsSave')}</Button>
        {presetStatus && <p role="status" className="text-sm">{tx(presetStatus)}</p>}
        <label className="flex items-center gap-2 min-h-[48px] text-sm cursor-pointer">
          <input type="checkbox" className="w-5 h-5" checked={nameDefault} onChange={(e) => toggleNameDefault(e.target.checked)} />
          {tx('namesDefault')}
        </label>
      </Card>

      <Card title={tx('passwordTitle')}>
        <div>
          <label htmlFor="set-current" className={labelClass}>{tx('passwordCurrent')}</label>
          <input id="set-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="set-next" className={labelClass}>{tx('passwordNew')}</label>
          <input id="set-next" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
        </div>
        <Button variant="outline" disabled={!current || next.length < 10} onClick={changePassword}>{tx('passwordChange')}</Button>
        {passwordStatus && <p role="status" className="text-sm">{tx(passwordStatus)}</p>}
      </Card>

      {Listing && (
        <Suspense fallback={null}>
          <Listing />
        </Suspense>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="underline text-sm min-h-[48px] cursor-pointer" onClick={() => onNavigate('/privacy')}>{tx('privacyLink')}</button>
        <Button variant="outline" onClick={onLogout} icon={<LogOut aria-hidden="true" className="w-4 h-4" />}>{tx('signOut')}</Button>
      </div>
      <p className={hintClass}>{tx('versionLine', { app: APP_VERSION, rules: settings.data?.current_rules_version ?? '—' })}</p>
    </div>
  );
};
