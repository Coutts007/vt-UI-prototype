import React, { useState } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../components/ui/Button';
import { RefreshCw, CheckCircle2, ChevronRight, AlertTriangle } from 'lucide-react';

interface ConflictsViewProps {
  onNavigate: (path: string) => void;
}

export const ConflictsView: React.FC<ConflictsViewProps> = ({ onNavigate }) => {
  const { t } = useI18n();

  const [hasConflict, setHasConflict] = useState(true);
  const [resolvedNotice, setResolvedNotice] = useState<string | null>(null);

  const handleResolve = (choice: 'newer' | 'server') => {
    setHasConflict(false);
    setResolvedNotice(
      choice === 'newer'
        ? 'Resolved: Applied newer version from client device.'
        : 'Resolved: Kept existing server version.'
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          {t('syncConflicts')}
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)] mt-0.5">
          Review and resolve profile version mismatches between client offline edits and server records
        </p>
      </div>

      {resolvedNotice && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{resolvedNotice}</span>
        </div>
      )}

      {!hasConflict ? (
        <div className="p-12 text-center rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
          <h2 className="text-base font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
            No active sync conflicts
          </h2>
          <p className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
            All client measurements are fully synchronized with the workshop records.
          </p>
        </div>
      ) : (
        /* Conflict Comparison Card */
        <div className="p-6 rounded-2xl border-2 border-amber-300 bg-white shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--vt-line,#DDD5C8)] pb-4">
            <div>
              <span className="font-mono font-black text-xl text-[var(--vt-thread,#2E3A87)]">
                Client NA9044
              </span>
              <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] block mt-0.5">
                Grace Wambui · Conflict detected on 10 Oct 2026
              </span>
            </div>

            <span className="text-xs font-bold text-amber-800 bg-amber-50 px-3 py-1 rounded-full border border-amber-200 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Version Mismatch
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Version on Server */}
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[var(--vt-line,#DDD5C8)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Server Version (v1)
              </span>
              <span className="text-xs text-slate-600 block mb-3">Captured 20 Sep 2026</span>
              <ul className="text-xs space-y-1.5 font-mono">
                <li>Shoulder: 39.5 cm</li>
                <li>Chest: 91.0 cm</li>
                <li>Waist: 75.0 cm</li>
                <li>Hip: 98.0 cm</li>
              </ul>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleResolve('server')}
                className="w-full mt-4 text-xs"
              >
                Keep Server Version
              </Button>
            </div>

            {/* Version from Client Phone */}
            <div className="p-4 rounded-xl bg-indigo-50/70 border-2 border-[var(--vt-thread,#2E3A87)]">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--vt-thread,#2E3A87)] block mb-1">
                Newer Client Version (v2)
              </span>
              <span className="text-xs text-slate-600 block mb-3">Captured 10 Oct 2026</span>
              <ul className="text-xs space-y-1.5 font-mono">
                <li>Shoulder: 39.8 cm</li>
                <li>Chest: 92.2 cm</li>
                <li>Waist: 76.5 cm</li>
                <li>Hip: 98.5 cm</li>
              </ul>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleResolve('newer')}
                className="w-full mt-4 text-xs"
              >
                Use Newer Client Version (Recommended)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
