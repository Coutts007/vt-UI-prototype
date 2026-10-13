import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'text';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none rounded-xl cursor-pointer select-none whitespace-nowrap shrink-0';

  const sizeClasses = {
    sm: 'text-xs h-9 px-3 gap-1.5 min-h-[44px]',
    md: 'text-sm h-11 px-4 gap-2 min-h-[48px]',
    lg: 'text-base h-12 px-5 gap-2.5 min-h-[48px]',
    xl: 'text-lg h-14 px-7 gap-3 min-h-[56px] font-semibold',
  }[size];

  const variantClasses = {
    primary:
      'bg-[var(--vt-thread,#2E3A87)] text-white hover:bg-[#232c69] shadow-sm active:bg-[#1a214f]',
    secondary:
      'bg-[#EDE6DA] text-[var(--vt-ink,#1F1C18)] hover:bg-[#E3DACB] active:bg-[#D9CEBC]',
    outline:
      'border border-[var(--vt-line,#DDD5C8)] text-[var(--vt-ink,#1F1C18)] bg-white hover:bg-[#F9F6F0]',
    danger:
      'bg-[var(--vt-fail,#B3261E)] text-white hover:bg-[#961e17] active:bg-[#7e1812]',
    text:
      'text-[var(--vt-ink-muted,#5C554C)] hover:text-[var(--vt-ink,#1F1C18)] hover:bg-black/5',
  }[variant];

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
};
