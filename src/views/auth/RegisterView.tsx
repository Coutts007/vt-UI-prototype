import React, { useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { ChevronLeft } from 'lucide-react';

interface RegisterViewProps {
  onNavigate: (path: string) => void;
}

export const RegisterView: React.FC<RegisterViewProps> = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [phone, setPhone] = useState('+2547');
  const [area, setArea] = useState('Gikomba, Nairobi');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      await api.registerTailor({
        email,
        business_name: businessName,
        phone,
        area,
        locale: 'en',
      });
      onNavigate('/register/pending');
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <button
        onClick={() => onNavigate('/login')}
        className="text-xs text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] flex items-center gap-1 mb-4 cursor-pointer font-medium"
      >
        <ChevronLeft className="w-4 h-4" />
        <span>Back to login</span>
      </button>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight mb-1">
        Register as a Tailor
      </h1>
      <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6">
        Create an account for your workshop. Registrations are reviewed by administrators.
      </p>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium mb-6">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Business Name
          </label>
          <input
            type="text"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Mama Wanjiru Tailors"
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Phone Number (Kenyan Format)
          </label>
          <input
            type="text"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+2547XXXXXXXX"
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Location / Area
          </label>
          <input
            type="text"
            required
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Gikomba, Eastleigh, CBD"
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Password (Min 10 characters)
          </label>
          <input
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-sm outline-none"
          />
        </div>

        <Button type="submit" size="xl" loading={loading} className="w-full mt-2">
          Submit for Approval
        </Button>
      </form>
    </div>
  );
};
