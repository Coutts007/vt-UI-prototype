import React, { useState } from 'react';
import { Measurement, SiteCode } from '../../types/api';
import { FlagBadge } from './FlagBadge';
import { useI18n } from '../../i18n';

interface SilhouetteProps {
  measurements: Measurement[];
  sex?: 'female' | 'male' | 'unspecified';
  unit?: 'cm' | 'in';
  onSelectSite?: (site: SiteCode) => void;
  className?: string;
}

export const Silhouette: React.FC<SilhouetteProps> = ({
  measurements,
  sex = 'female',
  unit = 'cm',
  onSelectSite,
  className = '',
}) => {
  const { t } = useI18n();
  const [selectedSite, setSelectedSite] = useState<SiteCode | null>(null);

  const getMeasurement = (code: SiteCode) =>
    measurements.find((m) => m.site_code === code);

  const formatValue = (valMm: number | null) => {
    if (valMm === null) return t('flagFail');
    if (unit === 'in') {
      const inches = valMm / 25.4;
      return `${inches.toFixed(1)} in`;
    }
    return `${(valMm / 10).toFixed(1)} cm`;
  };

  const isoTerms: Record<SiteCode, string> = {
    stature: 'stature, ISO 8559-1:2017 §3.1',
    shoulder: 'across shoulder, ISO 8559-1 §3.14',
    chest: sex === 'female' ? 'bust girth, ISO 8559-1 §3.6' : 'chest girth, ISO 8559-1 §3.7',
    waist: 'waist girth, ISO 8559-1 §3.9',
    hip: 'hip girth, ISO 8559-1 §3.11',
    sleeve: 'sleeve length, ISO 8559-1 §3.16',
    outleg: 'outside leg length, ISO 8559-1 §3.19',
    inleg: 'inside leg length (inseam), ISO 8559-1 §3.20',
    neck: 'neck girth, ISO 8559-1 §3.4',
  };

  const handleSiteClick = (code: SiteCode) => {
    setSelectedSite(code);
    if (onSelectSite) onSelectSite(code);
  };

  const leftSites: SiteCode[] = ['neck', 'chest', 'waist', 'hip'];
  const rightSites: SiteCode[] = ['shoulder', 'sleeve', 'outleg', 'inleg'];

  return (
    <div className={`flex flex-col items-center bg-white rounded-2xl border border-[var(--vt-line,#DDD5C8)] p-4 sm:p-6 shadow-xs ${className}`}>
      {/* 3-column Layout: Left Labels, SVG Silhouette in Center, Right Labels */}
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-[1fr_260px_1fr] items-center gap-4 sm:gap-6">
        {/* Left Column (Neck, Chest, Waist, Hip) */}
        <div className="flex flex-col gap-3 sm:gap-4 order-2 md:order-1">
          {leftSites.map((code) => {
            const m = getMeasurement(code);
            const isSelected = selectedSite === code;
            const siteLabelKey = code === 'chest' && sex === 'female' ? 'site_bust' : `site_${code}`;

            return (
              <button
                key={code}
                type="button"
                onClick={() => handleSiteClick(code)}
                className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 ring-2 ring-[var(--vt-thread,#2E3A87)]/20'
                    : 'border-[var(--vt-line,#DDD5C8)]/70 hover:border-[var(--vt-thread,#2E3A87)] bg-[#FDFBF7]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--vt-ink,#1F1C18)]">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {t(siteLabelKey as any)}
                  </span>
                  {m && <FlagBadge flag={m.confidence_flag} />}
                </div>
                <div className="text-lg font-bold text-[var(--vt-thread,#2E3A87)] tabular-nums mt-0.5">
                  {formatValue(m?.value_mm ?? null)}
                </div>
                <div className="text-[10px] text-[var(--vt-ink-muted,#5C554C)] opacity-75 font-mono truncate">
                  {isoTerms[code]}
                </div>
              </button>
            );
          })}
        </div>

        {/* Center: Anatomical SVG Silhouette with Leader Lines */}
        <div className="flex justify-center relative py-2 order-1 md:order-2">
          <svg
            viewBox="0 0 200 440"
            className="w-48 sm:w-56 h-auto drop-shadow-sm select-none"
            aria-label="Neutral human body silhouette showing measurement levels"
          >
            {/* Background Subtle Silhouette */}
            <path
              d="M 100 20
                 C 90 20, 85 28, 85 40
                 C 85 52, 92 60, 93 64
                 C 80 68, 65 78, 60 92
                 C 55 105, 52 135, 48 160
                 C 45 180, 42 210, 40 225
                 C 38 232, 42 236, 46 235
                 C 50 234, 53 225, 56 210
                 C 60 190, 64 165, 68 140
                 C 70 148, 72 170, 72 195
                 C 72 225, 68 260, 68 285
                 C 68 320, 70 365, 72 400
                 C 73 408, 80 412, 85 410
                 C 90 408, 92 400, 93 385
                 C 96 350, 98 300, 100 260
                 C 102 300, 104 350, 107 385
                 C 108 400, 110 408, 115 410
                 C 120 412, 127 408, 128 400
                 C 130 365, 132 320, 132 285
                 C 132 260, 128 225, 128 195
                 C 128 170, 130 148, 132 140
                 C 136 165, 140 190, 144 210
                 C 147 225, 150 234, 154 235
                 C 158 236, 162 232, 160 225
                 C 158 210, 155 180, 152 160
                 C 148 135, 145 105, 140 92
                 C 135 78, 120 68, 107 64
                 C 108 60, 115 52, 115 40
                 C 115 28, 110 20, 100 20 Z"
              fill="#EDE7DD"
              stroke="#D4C8B5"
              strokeWidth="2"
            />

            {/* Anchored Measurement Level Lines */}
            {/* Neck line */}
            <line x1="15" y1="62" x2="90" y2="62" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="100" cy="62" r="3.5" fill="#2E3A87" />

            {/* Shoulder line */}
            <line x1="60" y1="88" x2="185" y2="88" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="65" cy="88" r="3.5" fill="#2E3A87" />
            <circle cx="135" cy="88" r="3.5" fill="#2E3A87" />

            {/* Chest / Bust line */}
            <line x1="15" y1="120" x2="80" y2="120" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="100" cy="120" r="3.5" fill="#2E3A87" />

            {/* Waist line */}
            <line x1="15" y1="165" x2="75" y2="165" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="100" cy="165" r="3.5" fill="#2E3A87" />

            {/* Hip line */}
            <line x1="15" y1="205" x2="72" y2="205" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="100" cy="205" r="3.5" fill="#2E3A87" />

            {/* Sleeve line */}
            <line x1="150" y1="170" x2="185" y2="170" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="152" cy="170" r="3.5" fill="#2E3A87" />

            {/* Outside leg line */}
            <line x1="130" y1="290" x2="185" y2="290" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="130" cy="290" r="3.5" fill="#2E3A87" />

            {/* Inside leg (inseam) line */}
            <line x1="100" y1="330" x2="185" y2="330" stroke="#2E3A87" strokeWidth="1.5" strokeDasharray="3,3" />
            <circle cx="100" cy="260" r="3.5" fill="#2E3A87" />
          </svg>
        </div>

        {/* Right Column (Shoulder, Sleeve, Outside Leg, Inside Leg) */}
        <div className="flex flex-col gap-3 sm:gap-4 order-3">
          {rightSites.map((code) => {
            const m = getMeasurement(code);
            const isSelected = selectedSite === code;
            const siteLabelKey = `site_${code}`;

            return (
              <button
                key={code}
                type="button"
                onClick={() => handleSiteClick(code)}
                className={`text-left p-3 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'border-[var(--vt-thread,#2E3A87)] bg-indigo-50/70 ring-2 ring-[var(--vt-thread,#2E3A87)]/20'
                    : 'border-[var(--vt-line,#DDD5C8)]/70 hover:border-[var(--vt-thread,#2E3A87)] bg-[#FDFBF7]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--vt-ink,#1F1C18)]">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {t(siteLabelKey as any)}
                  </span>
                  {m && <FlagBadge flag={m.confidence_flag} />}
                </div>
                <div className="text-lg font-bold text-[var(--vt-thread,#2E3A87)] tabular-nums mt-0.5">
                  {formatValue(m?.value_mm ?? null)}
                </div>
                <div className="text-[10px] text-[var(--vt-ink-muted,#5C554C)] opacity-75 font-mono truncate">
                  {isoTerms[code]}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
