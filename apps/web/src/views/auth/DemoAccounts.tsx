// The seed's sign-ins, for development and the mock only. A production build never imports this file
// (LoginView loads it behind a build-time flag), so no demo email or password ships (M11).
import React from 'react';
import { useTailorText } from '../tailor/tailorText';

const DEMO_EMAILS = ['wanjiru@vt.test', 'otieno@vt.test', 'admin@vt.test', 'measurer-a@vt.test'];
const DEMO_PASSWORD = 'vt-demo-2026';

export const DemoAccounts: React.FC<{ onPick: (email: string, password: string) => void }> = ({ onPick }) => {
  const tx = useTailorText();
  return (
    <div className="p-4 rounded-xl border border-[var(--vt-line)] text-xs">
      <p className="font-bold mb-2">{tx('demoAccounts')}</p>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_EMAILS.map((account) => (
          <button
            key={account}
            type="button"
            className="p-2 min-h-[48px] rounded-lg bg-white border border-[var(--vt-line)] text-left cursor-pointer break-all"
            onClick={() => onPick(account, DEMO_PASSWORD)}
          >
            {account}
          </button>
        ))}
      </div>
    </div>
  );
};
