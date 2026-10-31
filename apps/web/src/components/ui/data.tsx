import React, { useEffect, useState } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n/en';

const STEPS: TranslationKey[] = ['stepDetails', 'stepConsent', 'stepSetup', 'stepFront', 'stepSide', 'stepReview'];

export const ProgressSteps: React.FC<{ current: number }> = ({ current }) => {
  const { t } = useI18n();
  return (
    <ol className="flex flex-wrap gap-x-2 text-sm">
      {STEPS.map((key, index) => (
        <li
          key={key}
          aria-current={index === current ? 'step' : undefined}
          className={index === current ? 'font-bold' : 'text-[var(--vt-ink-muted)]'}
        >
          {index > 0 && <span aria-hidden="true">› </span>}
          {t(key)}
        </li>
      ))}
    </ol>
  );
};

export type CheckItem = { key: string; label: string; state: 'pass' | 'fail' | 'wait' };

export const CheckList: React.FC<{ items: CheckItem[] }> = ({ items }) => (
  <ul className="space-y-1">
    {items.map((item) => (
      <li key={item.key} className="flex items-center gap-2 min-h-8">
        {item.state === 'pass' && <Check aria-hidden="true" className="size-5 text-[var(--vt-pass)]" />}
        {item.state === 'fail' && <X aria-hidden="true" className="size-5 text-[var(--vt-fail)]" />}
        {item.state === 'wait' && <TriangleAlert aria-hidden="true" className="size-5 text-[var(--vt-check)]" />}
        <span>{item.label}</span>
      </li>
    ))}
  </ul>
);

export const Countdown: React.FC<{ value: number }> = ({ value }) => (
  <div aria-live="assertive" className="text-[160px] leading-none font-bold tabular-nums text-center">
    {value}
  </div>
);

export function StatusChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-2 overflow-x-auto pb-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-12 px-4 rounded-full border whitespace-nowrap ${
            value === option.value
              ? 'bg-[var(--vt-thread)] text-[var(--vt-thread-ink)] border-transparent'
              : 'border-[var(--vt-line)] bg-[var(--vt-paper)]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
}

/** A table at 768 px and wider, and stacked cards below. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
}) {
  return (
    <>
      <table className="hidden md:table w-full text-left border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--vt-line)]">
            {columns.map((column) => (
              <th key={column.key} scope="col" className="py-2 pr-4 font-semibold">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-[var(--vt-line)]">
              {columns.map((column) => (
                <td key={column.key} className="py-2 pr-4">
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden space-y-3" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-lg border border-[var(--vt-line)] bg-[var(--vt-paper)] p-3">
            <dl className="grid grid-cols-2 gap-1">
              {columns.map((column) => (
                <React.Fragment key={column.key}>
                  <dt className="text-sm text-[var(--vt-ink-muted)]">{column.header}</dt>
                  <dd>{column.cell(row)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export const AuditRow: React.FC<{ when: string; action: string; summary: string; who?: string | null }> = ({
  when,
  action,
  summary,
  who,
}) => (
  <div className="py-2 border-b border-[var(--vt-line)]">
    <p className="font-medium">{action}</p>
    <p className="text-sm">{summary}</p>
    <p className="text-sm text-[var(--vt-ink-muted)]">
      {when}
      {who ? ` · ${who}` : ''}
    </p>
  </div>
);

export const QRCode: React.FC<{ text: string; label: string; size?: number }> = ({ text, label, size = 192 }) => {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let active = true;
    import('qrcode')
      .then((module) => module.toString(text, { type: 'svg', margin: 1, width: size }))
      .then((markup) => {
        if (active) setSvg(markup);
      })
      .catch(() => {
        if (active) setSvg('');
      });
    return () => {
      active = false;
    };
  }, [text, size]);
  return <div role="img" aria-label={label} style={{ width: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
};
