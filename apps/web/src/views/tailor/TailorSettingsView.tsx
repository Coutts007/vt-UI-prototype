import React, { lazy, Suspense, useState } from 'react';
import { FEATURE_DIRECTORY } from '../../config/features';
import { useI18n } from '../../i18n';
import { UserAccount } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { LogOut, Check } from 'lucide-react';

interface TailorSettingsViewProps {
  currentUser: UserAccount;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

// Loaded only when the directory is on, so a switched-off build carries none of it (D27).
const Listing = __VT_DIRECTORY__
  ? lazy(() => import('./DirectoryListingPanel').then((m) => ({ default: m.DirectoryListingPanel })))
  : null;

export const TailorSettingsView: React.FC<TailorSettingsViewProps> = ({
  currentUser,
  onNavigate,
  onLogout,
}) => {
  const { locale, setLocale, t } = useI18n();

  const [unitPref, setUnitPref] = useState<'cm' | 'in'>(currentUser.unit_pref || 'cm');
  const [businessName, setBusinessName] = useState(currentUser.business_name || '');
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [area, setArea] = useState(currentUser.area || '');
  const [address, setAddress] = useState(currentUser.address || '');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateTailorPublicProfile(currentUser.user_id, {
        unit_pref: unitPref,
        business_name: businessName,
        phone,
        area,
        address,
      });

      currentUser.unit_pref = unitPref;
      currentUser.business_name = businessName;
      currentUser.phone = phone;
      currentUser.area = area;
      currentUser.address = address;

      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          {t('dashboardSettings')}
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
          Measurement preferences and workshop information
        </p>
      </div>

      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Workshop settings updated successfully.</span>
        </div>
      )}

      {Listing && (
        <Suspense fallback={null}>
          <Listing />
        </Suspense>
      )}

      {/* 2. Basic Contact & Physical Location */}
      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
        <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
          Contact &amp; Physical Workshop Location
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="tailorsettingsview-4" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Business Name
            </label>
            <input id="tailorsettingsview-4"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
            />
          </div>

          <div>
            <label htmlFor="tailorsettingsview-5" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Contact Phone / WhatsApp
            </label>
            <input id="tailorsettingsview-5"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="tailorsettingsview-6" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Location / Area
            </label>
            <input id="tailorsettingsview-6"
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Gikomba, Nairobi"
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
            />
          </div>

          <div>
            <label htmlFor="tailorsettingsview-7" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Stall / Building Address
            </label>
            <input id="tailorsettingsview-7"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Stall 42B, Ground Floor"
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
            />
          </div>
        </div>
      </div>

      {/* 3. Measurement Units & Language */}
      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
        <div>
          <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-1">
            {t('unitsPreference')}
          </label>
          <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mb-2">
            Values are always recorded in millimetres and converted to your preferred display unit.
          </span>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setUnitPref('cm')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                unitPref === 'cm'
                  ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 text-[var(--vt-thread,#2E3A87)] ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                  : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
              }`}
            >
              {t('centimeters')}
            </button>
            <button
              type="button"
              onClick={() => setUnitPref('in')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                unitPref === 'in'
                  ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 text-[var(--vt-thread,#2E3A87)] ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                  : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
              }`}
            >
              {t('inches')}
            </button>
          </div>
        </div>

        <div className="pt-3 border-t border-[var(--vt-line,#DDD5C8)]/60">
          <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block mb-2">
            Language
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setLocale('en')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                locale === 'en'
                  ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 text-[var(--vt-thread,#2E3A87)] ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                  : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLocale('sw')}
              className={`py-2.5 px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                locale === 'sw'
                  ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 text-[var(--vt-thread,#2E3A87)] ring-2 ring-[var(--vt-thread,#2E3A87)]/15'
                  : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
              }`}
            >
              Kiswahili
            </button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between gap-4 pt-2">
        <Button onClick={handleSave} size="lg" loading={saving}>
          Save Workshop Changes
        </Button>

        <Button
          variant="outline"
          size="md"
          onClick={onLogout}
          icon={<LogOut className="w-4 h-4 text-rose-600" />}
          className="text-rose-700 hover:bg-rose-50"
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
};
