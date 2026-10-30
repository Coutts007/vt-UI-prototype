import React, { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { FlagBadge } from '../../components/ui/FlagBadge';
import { SyncBadge } from '../../components/ui/SyncBadge';
import { CodeInput } from '../../components/ui/CodeInput';
import { NumberInput } from '../../components/ui/NumberInput';
import { LevelBubble } from '../../components/ui/LevelBubble';
import { Silhouette } from '../../components/ui/Silhouette';
import { Measurement } from '../../types/api';

export const DevGalleryView: React.FC = () => {
  const [testCode, setTestCode] = useState('AB1234');
  const [testNum, setTestNum] = useState(170);
  const [testBeta, setTestBeta] = useState(90);
  const [testGamma, setTestGamma] = useState(0);

  const sampleMeasurements: Measurement[] = [
    { site_code: 'stature', value_mm: 1700, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
    { site_code: 'shoulder', value_mm: 415, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
    { site_code: 'chest', value_mm: 940, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
    { site_code: 'waist', value_mm: 785, method: 'auto', confidence_flag: 'check', flag_reasons: ['scale_disagree'] },
    { site_code: 'hip', value_mm: 1015, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
    { site_code: 'sleeve', value_mm: 585, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
    { site_code: 'outleg', value_mm: 1025, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
    { site_code: 'inleg', value_mm: null, method: 'auto', confidence_flag: 'fail', flag_reasons: ['crotch_not_found'] },
    { site_code: 'neck', value_mm: 365, method: 'auto', confidence_flag: 'pass', flag_reasons: [] },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      <div>
        <h1 className="text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
          UI Component Gallery (/dev/ui)
        </h1>
        <p className="text-sm text-[var(--vt-ink-muted,#5C554C)]">
          Live design tokens &amp; accessible UI components verification
        </p>
      </div>

      {/* Buttons */}
      <section className="space-y-3 p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
          Button Variants &amp; Sizes
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="text">Text Button</Button>
          <Button variant="primary" loading>Loading</Button>
        </div>
      </section>

      {/* Badges */}
      <section className="space-y-3 p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
          Confidence Flags &amp; Sync Badges
        </h2>
        <div className="flex flex-wrap items-center gap-4">
          <FlagBadge flag="pass" />
          <FlagBadge flag="check" reasons={['scale_disagree']} showReasonText />
          <FlagBadge flag="fail" reasons={['crotch_not_found']} showReasonText />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <SyncBadge status="synced" />
          <SyncBadge status="pending" />
          <SyncBadge status="conflict" />
          <SyncBadge status="rejected" />
        </div>
      </section>

      {/* Segmented Code Input */}
      <section className="space-y-3 p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
          Segmented Client Code Input
        </h2>
        <CodeInput value={testCode} onChange={setTestCode} />
      </section>

      {/* Interactive Level Bubble */}
      <section className="space-y-4 p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-slate-900 text-white shadow-2xs">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
          Spirit Level Bubble (C1 Compliant: Beta 88°–92°, Gamma ±2.5°)
        </h2>
        <div className="flex flex-col sm:flex-row items-center gap-8">
          <LevelBubble beta={testBeta} gamma={testGamma} size="lg" />
          <div className="flex-1 space-y-3 text-xs w-full">
            <div>
              <label className="block mb-1">Tilt (Beta: {testBeta}°)</label>
              <input
                type="range"
                min="70"
                max="110"
                step="0.5"
                value={testBeta}
                onChange={(e) => setTestBeta(parseFloat(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>
            <div>
              <label className="block mb-1">Roll (Gamma: {testGamma}°)</label>
              <input
                type="range"
                min="-15"
                max="15"
                step="0.5"
                value={testGamma}
                onChange={(e) => setTestGamma(parseFloat(e.target.value))}
                className="w-full accent-emerald-400"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Anatomical Silhouette */}
      <section className="space-y-4 p-6 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)]">
          Interactive SVG Silhouette (Figure 5.5)
        </h2>
        <Silhouette measurements={sampleMeasurements} sex="female" unit="cm" />
      </section>
    </div>
  );
};
