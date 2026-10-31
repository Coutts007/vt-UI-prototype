import React, { useState } from 'react';
import { FAILURE_KEY } from '../../../mocks/failure';

const OPTIONS = ['', '400', '401', '403', '404', '409', '422', '429', '500'];

/** Makes the mock answer every request with a chosen error, to exercise error screens. */
export const FailurePanel: React.FC = () => {
  const [value, setValue] = useState(() => sessionStorage.getItem(FAILURE_KEY) ?? '');
  const change = (next: string) => {
    setValue(next);
    if (next) sessionStorage.setItem(FAILURE_KEY, next);
    else sessionStorage.removeItem(FAILURE_KEY);
  };
  return (
    <label className="block space-y-1">
      <span className="font-semibold">Mock failure</span>
      <select
        value={value}
        onChange={(event) => change(event.target.value)}
        className="w-full min-h-12 rounded-lg border border-[#8A8176] px-3"
      >
        {OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option || 'None'}
          </option>
        ))}
      </select>
    </label>
  );
};
