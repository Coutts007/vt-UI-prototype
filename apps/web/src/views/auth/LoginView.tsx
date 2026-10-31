import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../api/client';
import { apiClient } from '../../api/instance';
import { UserAccount } from '../../types/api';
import { Button } from '../../components/ui/Button';
import { Lock, Mail, Eye, EyeOff, Scissors, Shield, ArrowRight } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: (user: UserAccount) => void;
  onNavigate: (path: string) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess, onNavigate }) => {
  const { t } = useI18n();

  const [email, setEmail] = useState('wanjiru@vt.test');
  const [password, setPassword] = useState('vt-demo-2026');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const user = await api.login(email, password);
      // Bridge until M9: the prototype sign-in has no token, and the directory panel needs one.
      await apiClient
        .post('/auth/login', { body: { email, password } })
        .then((reply) => apiClient.auth.setToken(reply.access_token, reply.expires_at))
        .catch(() => undefined);
      onLoginSuccess(user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (quickEmail: string) => {
    setEmail(quickEmail);
    setPassword('vt-demo-2026');
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8 min-h-[75vh] flex flex-col justify-center">
      <div className="w-12 h-12 rounded-2xl bg-[var(--vt-thread,#2E3A87)] text-white flex items-center justify-center mb-4 shadow-sm mx-auto">
        <Scissors className="w-6 h-6 stroke-[2.2]" />
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight text-center mb-1">
        Sign in to Virtual Tailor
      </h1>
      <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] text-center mb-6">
        Tailor workshop dashboard &amp; study portal
      </p>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium mb-6">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs space-y-4 mb-6">
        <div>
          <label htmlFor="loginview-1" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Email Address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input id="loginview-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full h-12 pl-10 pr-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
          </div>
        </div>

        <div>
          <label htmlFor="loginview-2" className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input id="loginview-2"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full h-12 pl-10 pr-10 rounded-xl border border-[var(--vt-line,#DDD5C8)] bg-white text-sm outline-none focus:border-[var(--vt-thread,#2E3A87)]"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={t(showPassword ? 'hidePassword' : 'showPassword')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-600 cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Button type="submit" size="xl" loading={loading} className="w-full mt-2">
          Sign In
        </Button>
      </form>

      {/* Quick Demo Accounts Selection */}
      <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)] text-xs mb-6">
        <span className="font-bold text-[var(--vt-ink,#1F1C18)] block mb-2">
          Demo Test Accounts (Password: <code>vt-demo-2026</code>)
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleQuickLogin('wanjiru@vt.test')}
            className="p-2 rounded-lg bg-white border border-[var(--vt-line,#DDD5C8)] text-left hover:border-[var(--vt-thread,#2E3A87)] cursor-pointer"
          >
            <strong>Wanjiru (Tailor)</strong>
            <span className="block text-[10px] text-slate-600">Mama Wanjiru Tailors</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('otieno@vt.test')}
            className="p-2 rounded-lg bg-white border border-[var(--vt-line,#DDD5C8)] text-left hover:border-[var(--vt-thread,#2E3A87)] cursor-pointer"
          >
            <strong>Otieno (Tailor)</strong>
            <span className="block text-[10px] text-slate-600">Otieno Bespoke</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('admin@vt.test')}
            className="p-2 rounded-lg bg-white border border-[var(--vt-line,#DDD5C8)] text-left hover:border-[var(--vt-thread,#2E3A87)] cursor-pointer"
          >
            <strong>Admin (Researcher)</strong>
            <span className="block text-[10px] text-slate-600">System Admin</span>
          </button>
          <button
            type="button"
            onClick={() => handleQuickLogin('measurerA@vt.test')}
            className="p-2 rounded-lg bg-white border border-[var(--vt-line,#DDD5C8)] text-left hover:border-[var(--vt-thread,#2E3A87)] cursor-pointer"
          >
            <strong>Measurer A</strong>
            <span className="block text-[10px] text-slate-600">Validation Study</span>
          </button>
        </div>
      </div>

      <div className="text-center text-xs text-[var(--vt-ink-muted,#5C554C)]">
        Want to join as a workshop?{' '}
        <button
          onClick={() => onNavigate('/register')}
          className="text-[var(--vt-thread,#2E3A87)] font-bold hover:underline cursor-pointer"
        >
          Register as a tailor
        </button>
      </div>
    </div>
  );
};
