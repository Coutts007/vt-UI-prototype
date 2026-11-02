import React, { lazy, Suspense, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ApiError, NetworkError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { UserAccount } from '../../types/api';
import { hintClass, inputClass, labelClass, Title } from '../tailor/common';
import { TailorKey, useTailorText } from '../tailor/tailorText';

const ERRORS: Record<string, TailorKey> = {
  invalid_credentials: 'loginWrong',
  account_disabled: 'loginDisabled',
  account_rejected: 'loginRejected',
  rate_limited: 'loginRateLimited',
};
// Seed accounts appear only where the seed exists: never in a production build.
const DemoAccounts =
  import.meta.env.DEV || import.meta.env.MODE === 'mock'
    ? lazy(() => import('./DemoAccounts').then((module) => ({ default: module.DemoAccounts })))
    : null;

export const LoginView: React.FC<{
  onLoginSuccess: (user: UserAccount) => void;
  onNavigate: (path: string) => void;
}> = ({ onLoginSuccess, onNavigate }) => {
  const tx = useTailorText();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const reply = await apiClient.post('/auth/login', { body: { email, password } });
      apiClient.auth.setToken(reply.access_token, reply.expires_at);
      const user = reply.user as unknown as UserAccount;
      sessionStorage.setItem('vt_session_user', JSON.stringify(user));
      onLoginSuccess(user);
    } catch (problem) {
      if (problem instanceof NetworkError) setError(tx('loginNetwork'));
      else if (problem instanceof ApiError && problem.code === 'account_pending') onNavigate('/register/pending');
      else if (problem instanceof ApiError && problem.code === 'account_locked') setError(tx('loginLocked', { minutes: 15 }));
      else setError(tx((problem instanceof ApiError && ERRORS[problem.code]) || 'loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">
      <Title>{tx('loginTitle')}</Title>
      <p className={hintClass}>{tx('loginIntro')}</p>
      {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">{error}</p>}
      <form onSubmit={submit} className="p-5 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3">
        <div>
          <label htmlFor="login-email" className={labelClass}>{tx('emailLabel')}</label>
          <input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="login-password" className={labelClass}>{tx('passwordLabel')}</label>
          <div className="relative">
            <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} pr-12`} />
            <button
              type="button"
              aria-label={tx(show ? 'hidePassword' : 'showPassword')}
              onClick={() => setShow(!show)}
              className="absolute right-0 top-0 w-12 h-12 inline-flex items-center justify-center cursor-pointer"
            >
              {show ? <EyeOff aria-hidden="true" className="w-4 h-4" /> : <Eye aria-hidden="true" className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" size="xl" loading={busy} className="w-full">{tx('signIn')}</Button>
      </form>
      {DemoAccounts && (
        <Suspense fallback={null}>
          <DemoAccounts
            onPick={(account, secret) => {
              setEmail(account);
              setPassword(secret);
            }}
          />
        </Suspense>
      )}
      <button type="button" onClick={() => onNavigate('/register')} className="underline text-sm min-h-[48px] cursor-pointer">
        {tx('registerLink')}
      </button>
    </main>
  );
};
