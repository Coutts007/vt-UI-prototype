import React, { useState } from 'react';
import { ApiError } from '../../api/http';
import { apiClient } from '../../api/instance';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n';
import { BackLink, hintClass, inputClass, labelClass, Title } from '../tailor/common';
import { TailorKey, useTailorText } from '../tailor/tailorText';

/** Length is the rule (frontend-spec 13.1). The server also refuses common passwords. */
export function passwordStrength(password: string): TailorKey {
  if (password.length < 10) return 'passwordWeak';
  return password.length < 14 ? 'passwordFair' : 'passwordStrong';
}

export const RegisterView: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const tx = useTailorText();
  const { locale } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [business, setBusiness] = useState('');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TailorKey | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/auth/register', {
        body: { email, password, business_name: business.trim(), phone: phone.trim(), area: area.trim(), locale },
      });
      onNavigate('/register/pending');
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.code : '';
      setError(code === 'validation_failed' ? 'registerInvalid' : code === 'rate_limited' ? 'loginRateLimited' : 'registerFailed');
    } finally {
      setBusy(false);
    }
  };

  const fields: [string, TailorKey, string, (value: string) => void, React.InputHTMLAttributes<HTMLInputElement>][] = [
    ['reg-business', 'businessLabel', business, setBusiness, { required: true, maxLength: 120 }],
    ['reg-phone', 'phoneLabel', phone, setPhone, { required: true, inputMode: 'tel', placeholder: '0712345678' }],
    ['reg-area', 'areaLabel', area, setArea, { required: true, maxLength: 120, placeholder: tx('registerAreaHint') }],
    ['reg-email', 'emailLabel', email, setEmail, { required: true, type: 'email', autoComplete: 'username' }],
  ];

  return (
    <main className="max-w-md mx-auto px-4 py-8 flex flex-col gap-4">
      <BackLink onClick={() => onNavigate('/login')} label={tx('backToLogin')} />
      <Title>{tx('registerTitle')}</Title>
      <p className={hintClass}>{tx('registerIntro')}</p>
      {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">{tx(error)}</p>}
      <form onSubmit={submit} className="p-5 rounded-2xl border border-[var(--vt-line)] bg-white flex flex-col gap-3">
        {fields.map(([id, label, value, set, extra]) => (
          <div key={id}>
            <label htmlFor={id} className={labelClass}>{tx(label)}</label>
            <input id={id} value={value} onChange={(e) => set(e.target.value)} className={inputClass} {...extra} />
          </div>
        ))}
        <div>
          <label htmlFor="reg-password" className={labelClass}>{tx('registerPassword')}</label>
          <input id="reg-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          {password && <p className={hintClass} data-testid="password-strength">{tx(passwordStrength(password))}</p>}
        </div>
        <Button type="submit" size="xl" loading={busy} className="w-full">{tx('registerSubmit')}</Button>
      </form>
    </main>
  );
};
