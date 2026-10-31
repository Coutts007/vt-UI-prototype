import React, { useState } from 'react';
import { FEATURE_DIRECTORY } from '../../config/features';
import { api } from '../../api/client';
import { UserAccount } from '../../types/api';
import { Button } from '../../components/ui/Button';
import {
  ChevronLeft,
  Building2,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Store,
  Tag,
  Clock,
  MapPin,
} from 'lucide-react';

interface RegisterViewProps {
  onNavigate: (path: string) => void;
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

const POPULAR_HUBS = [
  'Gikomba, Nairobi',
  'Westlands, Nairobi',
  'Nairobi CBD',
  'Eastleigh, Nairobi',
  'Mombasa Old Town',
  'Kisumu CBD',
  'Nakuru Town',
  'Eldoret Town',
];

export const RegisterView: React.FC<RegisterViewProps> = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('+2547');
  const [area, setArea] = useState('Gikomba, Nairobi');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([
    'Kitenge & African Wear',
    'Fast Alterations & Resizing',
  ]);
  const [turnaroundDays, setTurnaroundDays] = useState('3-5 days');
  const [pricingTier, setPricingTier] = useState<'Affordable' | 'Mid-Range' | 'Premium Bespoke'>('Mid-Range');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [registeredUser, setRegisteredUser] = useState<UserAccount | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const toggleSpecialty = (spec: string) => {
    if (specialties.includes(spec)) {
      if (specialties.length > 1) {
        setSpecialties(specialties.filter((s) => s !== spec));
      }
    } else {
      setSpecialties([...specialties, spec]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const user = await api.registerTailor({
        email,
        business_name: businessName,
        phone,
        area,
        address,
        specialties,
        description:
          description ||
          `${businessName} based in ${area}. Dedicated to high-precision tailoring and fine garment construction.`,
        turnaround_days: turnaroundDays,
        pricing_tier: pricingTier,
        locale: 'en',
      });
      setRegisteredUser(user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    });
  };

  // Success Confirmation Screen
  if (registeredUser) {
    const code = registeredUser.public_client_code || 'VT1000';
    return (
      <div className="max-w-xl mx-auto px-4 py-8 sm:py-12">
        <div className="p-6 sm:p-8 rounded-3xl border border-emerald-200 bg-white shadow-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center mb-5">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            Registration &amp; Listing Active
          </span>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mt-3 mb-2">
            Welcome, {registeredUser.business_name}!
          </h1>

          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] max-w-md mx-auto leading-relaxed mb-6">
            Your tailoring business is officially registered and listed in the public directory. Clients can now locate your workshop and send body measurements straight to your queue.
          </p>

          {/* Generated Code Display Card */}
          <div className="p-5 rounded-2xl bg-[var(--vt-chalk,#F7F3EC)] border border-[var(--vt-line,#DDD5C8)] max-w-sm mx-auto mb-6">
            <span className="text-xs font-semibold text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Your Workshop Public Client Code
            </span>
            <div className="flex items-center justify-center gap-3 my-2">
              <span className="font-mono text-3xl font-black text-[var(--vt-thread,#2E3A87)] tracking-widest bg-white px-4 py-2 rounded-xl border border-[var(--vt-line,#DDD5C8)] shadow-2xs">
                {code}
              </span>
              <button
                type="button"
                onClick={() => handleCopyCode(code)}
                className="p-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white hover:bg-slate-50 text-[var(--vt-ink,#1F1C18)] transition-colors cursor-pointer"
                title="Copy client code"
              >
                {copiedCode ? (
                  <Check className="w-5 h-5 text-emerald-600" />
                ) : (
                  <Copy className="w-5 h-5 text-[var(--vt-thread,#2E3A87)]" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] leading-normal mt-2">
              Share this code with clients via WhatsApp, SMS, or print it in your shop so they can start measuring.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              onClick={() => onNavigate('/login')}
              icon={<ArrowRight className="w-4 h-4" />}
            >
              Sign In to Workshop Dashboard
            </Button>
            {FEATURE_DIRECTORY && (
<Button
              variant="outline"
              size="lg"
              onClick={() => onNavigate('/tailors')}
              icon={<Store className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />}
            >
              View in Business Directory
            </Button>
)}
          </div>
        </div>
      </div>
    );
  }

  // Registration Form
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-10">
      <button
        onClick={() => onNavigate('/login')}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 mb-4 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to login</span>
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs uppercase font-bold tracking-wider text-[var(--vt-thread,#2E3A87)] bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
            Fundi / Workshop Onboarding
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          Register Your Tailoring Business
        </h1>
        <p className="text-xs sm:text-sm text-[var(--vt-ink-muted,#5C554C)] mt-1">
          Get listed in the verified fundi directory, receive an exclusive 6-character client code, and accept digital measurements from customers anywhere in Kenya.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium mb-6">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 sm:p-8 rounded-3xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-6">
        {/* Basic Business Info */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
            <span>1. Workshop Details</span>
          </h2>

          <div>
            <label htmlFor="registerview-1" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Business / Workshop Name *
            </label>
            <input id="registerview-1"
              type="text"
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Amani Couture &amp; Tailors"
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="registerview-2" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Owner Email Address *
              </label>
              <input id="registerview-2"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="fundi@domain.ke"
                className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
              />
            </div>

            <div>
              <label htmlFor="registerview-3" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Phone Number (M-Pesa / WhatsApp) *
              </label>
              <input id="registerview-3"
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+2547XXXXXXXX"
                className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="registerview-4" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Town / Commercial Area *
            </label>
            <input id="registerview-4"
              type="text"
              required
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Gikomba, Nairobi"
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)] mb-2"
            />
            {/* Quick Hub Badges */}
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] mr-1">Quick pick:</span>
              {POPULAR_HUBS.map((hub) => (
                <button
                  key={hub}
                  type="button"
                  onClick={() => setArea(hub)}
                  className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                    area === hub
                      ? 'bg-indigo-50 border-indigo-300 text-[var(--vt-thread,#2E3A87)] font-semibold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {hub}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="registerview-5" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Physical Stall or Building Address (Optional)
            </label>
            <input id="registerview-5"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Stall 42B, Ground Floor, Biashara Plaza"
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
          </div>
        </div>

        {/* Directory Listing & Specialties */}
        <div className="space-y-4 pt-4 border-t border-[var(--vt-line,#DDD5C8)]/70">
          <h2 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] uppercase tracking-wider flex items-center gap-2">
            <Tag className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
            <span>2. Directory Specialties &amp; Portfolio</span>
          </h2>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1.5">
              Select Your Garment Specialties (Pick all that apply)
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

          <div>
            <label htmlFor="registerview-6" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Short Description / Bio (Visible to Customers in Directory)
            </label>
            <textarea id="registerview-6"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Family-run bespoke tailoring house in Gikomba specializing in African wax print dresses, wedding entourage suits, and precise alterations with over 10 years experience."
              className="w-full p-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="registerview-7" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Typical Turnaround Time
              </label>
              <select id="registerview-7"
                value={turnaroundDays}
                onChange={(e) => setTurnaroundDays(e.target.value)}
                className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none bg-white focus:border-[var(--vt-thread,#2E3A87)]"
              >
                <option value="2-3 days">2-3 days (Express)</option>
                <option value="3-5 days">3-5 days (Standard)</option>
                <option value="5-7 days">5-7 days (1 week)</option>
                <option value="1-2 weeks">1-2 weeks (Intricate / Wedding)</option>
              </select>
            </div>

            <div>
              <label htmlFor="registerview-8" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Pricing Tier
              </label>
              <select id="registerview-8"
                value={pricingTier}
                onChange={(e) => setPricingTier(e.target.value as any)}
                className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none bg-white focus:border-[var(--vt-thread,#2E3A87)]"
              >
                <option value="Affordable">Affordable (Budget-friendly)</option>
                <option value="Mid-Range">Mid-Range (Standard quality)</option>
                <option value="Premium Bespoke">Premium Bespoke (Luxury craft)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Account Password */}
        <div className="space-y-4 pt-4 border-t border-[var(--vt-line,#DDD5C8)]/70">
          <h2 className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] uppercase tracking-wider flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[var(--vt-thread,#2E3A87)]" />
            <span>3. Account Security</span>
          </h2>

          <div>
            <label htmlFor="registerview-9" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
              Account Password *
            </label>
            <input id="registerview-9"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter secure password"
              className="w-full h-12 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
            <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] mt-1 block">
              Demo master password is also accepted: <code className="bg-slate-100 px-1 py-0.5 rounded">vt-demo-2026</code>
            </span>
          </div>
        </div>

        {/* Submit */}
        <div className="pt-2">
          <Button
            type="submit"
            size="xl"
            loading={loading}
            className="w-full"
            icon={<Sparkles className="w-4 h-4" />}
          >
            Register Business &amp; Get Tailor Code
          </Button>
          <p className="text-xs text-center text-[var(--vt-ink-muted,#5C554C)] mt-3">
            By registering, your workshop will be listed in the Virtual Tailor public directory. You can edit your listing or adjust visibility anytime.
          </p>
        </div>
      </form>
    </div>
  );
};
