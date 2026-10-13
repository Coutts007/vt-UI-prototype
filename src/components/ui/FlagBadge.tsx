import React from 'react';
import { Flag, FlagReason } from '../../types/api';
import { useI18n } from '../../i18n';
import { Check, AlertTriangle, X } from 'lucide-react';

interface FlagBadgeProps {
  flag: Flag;
  reasons?: FlagReason[];
  showReasonText?: boolean;
  className?: string;
}

export const FlagBadge: React.FC<FlagBadgeProps> = ({
  flag,
  reasons = [],
  showReasonText = false,
  className = '',
}) => {
  const { t } = useI18n();

  const config = {
    pass: {
      label: t('flagPass'),
      bg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      icon: <Check className="w-3.5 h-3.5 stroke-[2.5]" />,
    },
    check: {
      label: t('flagCheck'),
      bg: 'bg-amber-50 border-amber-300 text-amber-900',
      icon: <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />,
    },
    fail: {
      label: t('flagFail'),
      bg: 'bg-rose-50 border-rose-200 text-rose-800',
      icon: <X className="w-3.5 h-3.5 stroke-[2.5]" />,
    },
  }[flag];

  const reasonLabels: Record<FlagReason, string> = {
    scale_disagree: 'Scale disagreement',
    level_unchecked: 'Phone level unchecked',
    loose_clothing: 'Loose clothing declared',
    landmark_low: 'Pose confidence low',
    mask_gap: 'Body edge indistinct',
    out_of_range: 'Outside expected human bounds',
    crotch_not_found: 'Crotch not clearly separated',
    marker_weak: 'Measuring sheet corner weak',
    waist_level_mismatch: 'Waist narrow point deviation',
    view_failed: 'View capture incomplete',
  };

  return (
    <div className={`inline-flex flex-col items-start ${className}`}>
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-semibold tabular-nums tracking-tight ${config.bg}`}
      >
        {config.icon}
        <span>{config.label}</span>
      </span>
      {showReasonText && reasons.length > 0 && (
        <span className="text-[11px] text-[var(--vt-ink-muted,#5C554C)] mt-0.5 leading-tight">
          {reasons.map((r) => reasonLabels[r] || r).join(', ')}
        </span>
      )}
    </div>
  );
};
