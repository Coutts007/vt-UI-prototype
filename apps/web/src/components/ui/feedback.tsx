import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';

export const Banner: React.FC<{ tone?: 'info' | 'warn'; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => (
  <div
    role="status"
    className={`px-4 py-2 text-sm font-medium ${
      tone === 'warn' ? 'bg-[#FBEFD5] text-[var(--vt-ink)]' : 'bg-[var(--vt-paper)] text-[var(--vt-ink)]'
    } border-b border-[var(--vt-line)]`}
  >
    {children}
  </div>
);

export const Toast: React.FC<{
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}> = ({ actionLabel, onAction, children }) => (
  <div
    role="status"
    className="fixed bottom-4 inset-x-4 mx-auto max-w-md rounded-lg bg-[var(--vt-ink)] text-white p-4 flex items-center justify-between gap-4 z-50"
  >
    <span>{children}</span>
    {actionLabel && (
      <button type="button" onClick={onAction} className="min-h-12 px-3 font-semibold underline">
        {actionLabel}
      </button>
    )}
  </div>
);

export const Skeleton: React.FC = () => {
  const { t } = useI18n();
  return (
    <div role="status" aria-label={t('loading')} className="p-6 space-y-3 motion-safe:animate-pulse">
      <div className="h-6 w-1/2 rounded bg-[var(--vt-line)]" />
      <div className="h-4 w-full rounded bg-[var(--vt-line)]" />
      <div className="h-4 w-3/4 rounded bg-[var(--vt-line)]" />
    </div>
  );
};

export const EmptyState: React.FC<{ title?: string; children?: React.ReactNode }> = ({ title, children }) => {
  const { t } = useI18n();
  return (
    <div className="p-8 text-center text-[var(--vt-ink-muted)]">
      <p className="font-semibold text-[var(--vt-ink)]">{title ?? t('emptyDefault')}</p>
      {children}
    </div>
  );
};

export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  const { t } = useI18n();
  return (
    <div role="alert" className="p-8 text-center">
      <p className="font-semibold">{message ?? t('errorGenericTitle')}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 min-h-12 px-4 underline font-semibold">
          {t('retry')}
        </button>
      )}
    </div>
  );
};

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export const Dialog: React.FC<{
  title: string;
  open: boolean;
  onClose: () => void;
  sheet?: boolean;
  children: React.ReactNode;
}> = ({ title, open, onClose, sheet = false, children }) => {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => before?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => {
      document.removeEventListener('keydown', onEscape);
      root?.removeAttribute('inert');
    };
  }, [open, onClose]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 z-50 bg-black/50 flex justify-center ${sheet ? 'items-end' : 'items-center'} p-0 sm:p-4`}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
        className={`bg-[var(--vt-paper)] p-6 w-full max-w-md max-h-[90vh] overflow-y-auto ${sheet ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      >
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-12 min-w-12 underline">
            {t('dialogClose')}
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
};

export const BottomSheet: React.FC<Omit<React.ComponentProps<typeof Dialog>, 'sheet'>> = (props) => (
  <Dialog {...props} sheet />
);
