import React, { useId } from 'react';
import { useI18n, Locale } from '../../i18n';

export const LangToggle: React.FC = () => {
  const { locale, setLocale } = useI18n();
  const options: [Locale, string][] = [
    ['en', 'EN'],
    ['sw', 'SW'],
  ];
  return (
    <div role="group" aria-label="Language / Lugha" className="inline-flex rounded-lg border border-[var(--vt-line)]">
      {options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={locale === value}
          onClick={() => setLocale(value)}
          className={`min-h-12 min-w-12 font-semibold ${
            locale === value ? 'bg-[var(--vt-thread)] text-[var(--vt-thread-ink)]' : ''
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

export const Field: React.FC<{
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => React.ReactNode;
}> = ({ label, hint, error, children }) => {
  const id = useId();
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-[var(--vt-ink-muted)]">
          {hint}
        </p>
      )}
      {children({ id, 'aria-describedby': described, 'aria-invalid': error ? true : undefined })}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-[var(--vt-fail)]">
          {error}
        </p>
      )}
    </div>
  );
};

const INPUT = 'w-full min-h-12 rounded-lg border border-[#8A8176] bg-[var(--vt-paper)] px-3';

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select {...props} className={INPUT} />
);

export const DatePicker: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input {...props} type="date" className={INPUT} />
);

export const Checkbox: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex items-start gap-3 min-h-12 py-2 cursor-pointer">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="size-6 mt-0.5 accent-[var(--vt-thread)]"
    />
    <span>{label}</span>
  </label>
);

export function RadioCards<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2">
      <legend className="font-semibold mb-1">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex gap-3 min-h-12 p-3 rounded-lg border cursor-pointer ${
            value === option.value ? 'border-[var(--vt-thread)] border-2' : 'border-[var(--vt-line)]'
          }`}
        >
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="size-5 mt-0.5 accent-[var(--vt-thread)]"
          />
          <span>
            <span className="font-medium">{option.label}</span>
            {option.hint && <span className="block text-sm text-[var(--vt-ink-muted)]">{option.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
