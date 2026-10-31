import React, { useState } from 'react';
import { api } from '../../api/client';
import { UserAccount } from '../../types/api';
import { Button } from '../../components/ui/Button';
import { ChevronLeft, Building2, CheckCircle2, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';

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
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [registeredUser, setRegisteredUser] = useState<UserAccount | null>(null);

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
        locale: 'en',
      });
      setRegisteredUser(user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  // Success Confirmation Screen
  if (registeredUser) {
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
            Your tailoring business is registered. You can issue client codes from your dashboard.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              onClick={() => onNavigate('/login')}
              icon={<ArrowRight className="w-4 h-4" />}
            >
              Sign In to Workshop Dashboard
            </Button>
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
          Issue a code to each client and accept digital measurements from customers anywhere in Kenya.
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
            Register Business
          </Button>
        </div>
      </form>
    </div>
  );
};
