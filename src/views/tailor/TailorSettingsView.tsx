import React, { useState } from 'react';
import { useI18n, Locale } from '../../i18n';
import { UserAccount } from '../../types/api';
import { Button } from '../../components/ui/Button';
import { Settings, Globe, Ruler, LogOut, Check } from 'lucide-react';

interface TailorSettingsViewProps {
  currentUser: UserAccount;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

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
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = () => {
    currentUser.unit_pref = unitPref;
    currentUser.business_name = businessName;
    currentUser.phone = phone;
    currentUser.area = area;
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          {t('dashboardSettings')}
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
          Workshop configuration, measurement units, and business preferences
        </p>
      </div>

      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Settings updated successfully.</span>
        </div>
      )}

      {/* Units & Language */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
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

      {/* Workshop Profile */}
      <div className="p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-3">
        <h2 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)]">Workshop Profile</h2>

        <div>
          <label className="text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Business Name
          </label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Contact Phone Number
          </label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Workshop Location / Area
          </label>
          <input
            type="text"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm"
          />
        </div>

        <Button onClick={handleSave} size="md" className="mt-2">
          Save Settings
        </Button>
      </div>

      {/* Sign Out Button */}
      <div className="pt-2">
        <Button
          variant="outline"
          size="lg"
          onClick={onLogout}
          icon={<LogOut className="w-4 h-4 text-rose-600" />}
          className="w-full text-rose-700 hover:bg-rose-50"
        >
          Sign Out of Workshop
        </Button>
      </div>
    </div>
  );
};
