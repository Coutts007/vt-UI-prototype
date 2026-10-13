import React from 'react';

interface NumberInputProps {
  value: number | string;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  className?: string;
  onOfferConvert?: (cm: number) => void;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min = 0,
  max = 999,
  unit = 'cm',
  placeholder = '',
  hint,
  error,
  className = '',
  onOfferConvert,
}) => {
  const numVal = typeof value === 'number' ? value : parseFloat(value) || 0;

  // Detect likely feet entry: e.g. 5.7 -> 5ft 7in = 170 cm
  const isLikelyFeet = numVal >= 4.0 && numVal <= 7.5;
  const suggestedCm = isLikelyFeet
    ? Math.round((Math.floor(numVal) * 12 + (numVal - Math.floor(numVal)) * 10) * 2.54)
    : null;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="relative flex items-center">
        <input
          type="number"
          value={value === 0 ? '' : value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          placeholder={placeholder}
          className={`w-full h-12 px-4 pr-12 rounded-xl border bg-white text-base font-medium text-[var(--vt-ink,#1F1C18)] tabular-nums transition-colors outline-none focus:border-[var(--vt-thread,#2E3A87)] focus:ring-2 focus:ring-[var(--vt-thread,#2E3A87)]/20 ${
            error ? 'border-rose-400' : 'border-[var(--vt-line,#DDD5C8)]'
          }`}
        />
        {unit && (
          <span className="absolute right-4 text-sm font-medium text-[var(--vt-ink-muted,#5C554C)] pointer-events-none">
            {unit}
          </span>
        )}
      </div>

      {isLikelyFeet && suggestedCm && onOfferConvert && (
        <button
          type="button"
          onClick={() => onOfferConvert(suggestedCm)}
          className="text-left text-xs text-[var(--vt-thread,#2E3A87)] hover:underline mt-0.5 bg-indigo-50/60 p-2 rounded-lg border border-indigo-100 cursor-pointer"
        >
          Did you mean {Math.floor(numVal)} ft {Math.round((numVal - Math.floor(numVal)) * 10)} in? Tap to convert to <strong>{suggestedCm} cm</strong>
        </button>
      )}

      {hint && !error && <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">{hint}</span>}
      {error && <span className="text-xs text-rose-600 font-medium">{error}</span>}
    </div>
  );
};
