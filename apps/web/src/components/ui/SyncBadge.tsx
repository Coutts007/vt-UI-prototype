import React from 'react';
import { Cloud, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface SyncBadgeProps {
  status: 'pending' | 'synced' | 'conflict' | 'rejected';
  className?: string;
}

export const SyncBadge: React.FC<SyncBadgeProps> = ({ status, className = '' }) => {
  const configs = {
    synced: {
      label: 'Synced',
      bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      icon: <Check className="w-3 h-3 stroke-[2.5]" />,
    },
    pending: {
      label: 'Pending online sync',
      bg: 'bg-sky-50 text-sky-800 border-sky-200',
      icon: <Cloud className="w-3 h-3 stroke-[2]" />,
    },
    conflict: {
      label: 'Version conflict',
      bg: 'bg-amber-50 text-amber-800 border-amber-300',
      icon: <RefreshCw className="w-3 h-3 stroke-[2]" />,
    },
    rejected: {
      label: 'Code not found',
      bg: 'bg-rose-50 text-rose-800 border-rose-200',
      icon: <AlertCircle className="w-3 h-3 stroke-[2]" />,
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium tabular-nums ${configs.bg} ${className}`}
    >
      {configs.icon}
      <span>{configs.label}</span>
    </span>
  );
};
