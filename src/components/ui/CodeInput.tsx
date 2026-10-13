import React, { useRef } from 'react';

interface CodeInputProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export const CodeInput: React.FC<CodeInputProps> = ({
  value,
  onChange,
  onBlur,
  disabled = false,
  error,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const cleanVal = (value || '').toUpperCase().slice(0, 6);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    onChange(raw.slice(0, 6));
  };

  const focusInput = () => {
    inputRef.current?.focus();
  };

  // 6 boxes: 2 letters, 4 digits
  const chars = cleanVal.padEnd(6, ' ').split('').slice(0, 6);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {/* Hidden native input */}
      <input
        ref={inputRef}
        type="text"
        value={cleanVal}
        onChange={handleInputChange}
        onBlur={onBlur}
        disabled={disabled}
        maxLength={6}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="sr-only"
        aria-label="Client code 6 characters"
      />

      {/* Segmented 6-box visual representation */}
      <div
        onClick={focusInput}
        className="flex items-center gap-2 cursor-pointer select-none"
      >
        {chars.map((char, idx) => {
          const isFilled = char.trim().length > 0;
          const isCurrent = idx === cleanVal.length;
          const isLetterBox = idx < 2;

          return (
            <div
              key={idx}
              className={`w-11 h-13 sm:w-12 sm:h-14 rounded-xl border flex flex-col items-center justify-center font-mono text-xl sm:text-2xl font-bold transition-all ${
                isCurrent
                  ? 'border-[var(--vt-thread,#2E3A87)] ring-2 ring-[var(--vt-thread,#2E3A87)]/20 bg-white'
                  : isFilled
                  ? 'border-[var(--vt-line,#DDD5C8)] bg-white text-[var(--vt-ink,#1F1C18)] shadow-sm'
                  : 'border-[var(--vt-line,#DDD5C8)] bg-[#FBF9F5] text-[var(--vt-ink-muted,#5C554C)]/40'
              } ${error ? 'border-rose-400' : ''}`}
            >
              <span>{isFilled ? char : ''}</span>
              <span className="text-[9px] font-sans font-normal text-[var(--vt-ink-muted,#5C554C)] tracking-tighter -mt-1 opacity-60">
                {isLetterBox ? 'letter' : 'digit'}
              </span>
            </div>
          );
        })}
      </div>

      {error && <span className="text-xs text-rose-600 mt-1">{error}</span>}
    </div>
  );
};
