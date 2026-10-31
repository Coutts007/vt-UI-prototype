import React, { useState } from 'react';
import { FEATURE_DIRECTORY } from '../../config/features';
import { useI18n } from '../../i18n';
import { UserAccount } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import {
  Settings,
  Globe,
  Ruler,
  LogOut,
  Check,
  Store,
  Copy,
  ExternalLink,
  Sparkles,
  Tag,
  Clock,
  MapPin,
  Eye,
  EyeOff,
} from 'lucide-react';

interface TailorSettingsViewProps {
  currentUser: UserAccount;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

const AVAILABLE_SPECIALTIES = [
  'Kitenge & African Wear',
  'Bespoke Suits & Shirts',
  'Wedding & Evening Dresses',
  'Modest & Hijab Wear',
  'School & Work Uniforms',
  'Fast Alterations & Resizing',
  'Traditional Garments',
  'Casual & Denim',
];

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
  const [description, setDescription] = useState(currentUser.description || '');
  const [turnaroundDays, setTurnaroundDays] = useState(currentUser.turnaround_days || '5-7 days');
  const [pricingTier, setPricingTier] = useState<'Affordable' | 'Mid-Range' | 'Premium Bespoke'>(
    currentUser.pricing_tier || 'Mid-Range'
  );
  const [specialties, setSpecialties] = useState<string[]>(
    currentUser.specialties || ['Kitenge & African Wear', 'Fast Alterations & Resizing']
  );
  const [isListed, setIsListed] = useState<boolean>(currentUser.is_directory_listed !== false);

  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const clientCode = currentUser.public_client_code || 'MW1000';

  const toggleSpecialty = (spec: string) => {
    if (specialties.includes(spec)) {
      if (specialties.length > 1) {
        setSpecialties(specialties.filter((s) => s !== spec));
      }
    } else {
      setSpecialties([...specialties, spec]);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(clientCode).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateTailorPublicProfile(currentUser.user_id, {
        unit_pref: unitPref,
        business_name: businessName,
        phone,
        area,
        address,
        description,
        turnaround_days: turnaroundDays,
        pricing_tier: pricingTier,
        specialties,
        is_directory_listed: isListed,
      });

      currentUser.unit_pref = unitPref;
      currentUser.business_name = businessName;
      currentUser.phone = phone;
      currentUser.area = area;
      currentUser.address = address;
      currentUser.description = description;
      currentUser.turnaround_days = turnaroundDays;
      currentUser.pricing_tier = pricingTier;
      currentUser.specialties = specialties;
      currentUser.is_directory_listed = isListed;

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
          Public directory profile, client code, measurement preferences, and workshop information
        </p>
      </div>

      {savedNotice && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600" />
          <span>Workshop settings and directory profile updated successfully.</span>
        </div>
      )}

      {/* 1. Public Directory & Primary Client Code Banner */}
      <div className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--vt-line,#DDD5C8)]/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-[var(--vt-thread,#2E3A87)] flex items-center justify-center font-bold">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)]">
                Public Business Code &amp; Directory Listing
              </h2>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                Clients use this unique code to submit body measurements remotely
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {FEATURE_DIRECTORY && (
<button
              type="button"
              onClick={() => onNavigate('/tailors')}
              className="text-xs font-semibold text-[var(--vt-thread,#2E3A87)] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Preview Directory</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
)}
          </div>
        </div>

        {/* Code Highlight Box */}
        <div className="p-4 rounded-xl bg-[var(--vt-chalk,#F7F3EC)] border border-[var(--vt-line,#DDD5C8)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block font-medium">
              Your Primary Workshop Client Code:
            </span>
            <div className="flex items-center gap-2 mt-1 justify-center sm:justify-start">
              <span className="font-mono text-2xl font-black text-[var(--vt-thread,#2E3A87)] tracking-wider">
                {clientCode}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="p-1.5 rounded-lg border border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-slate-50 text-[var(--vt-ink,#1F1C18)] cursor-pointer transition-colors"
                title="Copy client code"
              >
                {copiedCode ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--vt-ink-muted,#5C554C)]">Listing Status:</span>
              <button
                type="button"
                onClick={() => setIsListed(!isListed)}
                className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 border cursor-pointer transition-colors ${
                  isListed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-slate-100 border-slate-300 text-slate-600'
                }`}
              >
                {isListed ? (
                  <>
                    <Eye className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Active in Directory</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                    <span>Hidden</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Directory Fields */}
        <div className="space-y-4 pt-2">
          <div>
            <label htmlFor="tailorsettingsview-1" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Workshop Bio / Description
            </label>
            <textarea id="tailorsettingsview-1"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell clients about your workshop, experience, and custom styles..."
              className="w-full p-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1.5">
              Garment Specialties
            </label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_SPECIALTIES.map((spec) => {
                const active = specialties.includes(spec);
                return (
                  <button
                    key={spec}
                    type="button"
                    onClick={() => toggleSpecialty(spec)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                      active
                        ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/80 text-[var(--vt-thread,#2E3A87)] font-bold shadow-2xs'
                        : 'border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink,#1F1C18)] hover:bg-[#FAF8F5]'
                    }`}
                  >
                    {active ? '✓ ' : '+ '}
                    {spec}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="tailorsettingsview-2" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Typical Turnaround Time
              </label>
              <select id="tailorsettingsview-2"
                value={turnaroundDays}
                onChange={(e) => setTurnaroundDays(e.target.value)}
                className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm bg-white"
              >
                <option value="2-3 days">2-3 days (Express)</option>
                <option value="3-5 days">3-5 days (Standard)</option>
                <option value="5-7 days">5-7 days (1 week)</option>
                <option value="1-2 weeks">1-2 weeks (Intricate / Wedding)</option>
              </select>
            </div>

            <div>
              <label htmlFor="tailorsettingsview-3" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Pricing Tier
              </label>
              <select id="tailorsettingsview-3"
                value={pricingTier}
                onChange={(e) => setPricingTier(e.target.value as any)}
                className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm bg-white"
              >
                <option value="Affordable">Affordable (Budget-friendly)</option>
                <option value="Mid-Range">Mid-Range (Standard quality)</option>
                <option value="Premium Bespoke">Premium Bespoke (Luxury craft)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

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
