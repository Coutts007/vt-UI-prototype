import React, { useState } from 'react';
import { SiteCode } from '../../types/api';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { PLAUSIBLE_RANGES_MM } from '../../measure/rules';
import { Ruler, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

interface StudyReferenceTapeViewProps {
  onNavigate: (path: string) => void;
  measurerCode?: string;
}

export const StudyReferenceTapeView: React.FC<StudyReferenceTapeViewProps> = ({
  onNavigate,
  measurerCode = 'A',
}) => {
  const [participantCode, setParticipantCode] = useState('P001');
  const [readingNo, setReadingNo] = useState<1 | 2>(1);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 9 sites in Appendix C order
  const siteList: { code: SiteCode; label: string; desc: string }[] = [
    { code: 'stature', label: '1. Stature / Height', desc: 'Barefoot, head in Frankfort horizontal plane' },
    { code: 'shoulder', label: '2. Across Shoulder Width', desc: 'Distance between left and right acromion processes' },
    { code: 'chest', label: '3. Chest / Bust Girth', desc: 'Circumference at maximum bust or mid-sternum' },
    { code: 'waist', label: '4. Natural Waist Girth', desc: 'Circumference at natural narrowing above iliac crest' },
    { code: 'hip', label: '5. Hip Girth', desc: 'Maximum horizontal circumference across buttocks' },
    { code: 'sleeve', label: '6. Sleeve Length', desc: 'From acromion over bent elbow to wrist styloid' },
    { code: 'outleg', label: '7. Outside Leg Length', desc: 'From natural waist level down to lateral malleolus / floor' },
    { code: 'inleg', label: '8. Inside Leg Length (Inseam)', desc: 'From perineum crotch point along medial axis to floor' },
    { code: 'neck', label: '9. Neck Girth', desc: 'Circumference at base of neck just above clavicle' },
  ];

  const [values, setValues] = useState<Record<SiteCode, string>>({
    stature: '170.0',
    shoulder: '41.5',
    chest: '94.0',
    waist: '78.0',
    hip: '101.0',
    sleeve: '58.5',
    outleg: '102.0',
    inleg: '77.5',
    neck: '36.5',
  });

  const handleValChange = (code: SiteCode, str: string) => {
    setValues((prev) => ({ ...prev, [code]: str }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const parsedValues: Record<SiteCode, number> = {} as any;
      Object.entries(values).forEach(([c, s]) => {
        parsedValues[c as SiteCode] = Math.round(parseFloat(s) * 10);
      });

      await api.submitReferenceReading({
        participant_code: participantCode,
        reading_no: readingNo,
        values_mm: parsedValues,
      });

      setSubmitted(true);
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--vt-line,#DDD5C8)] pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--vt-ink,#1F1C18)] tracking-tight">
            Double-Blind Reference Tape Entry
          </h1>
          <p className="text-sm text-[var(--vt-ink-muted,#5C554C)]">
            Measurer {measurerCode} · Reading {readingNo} · Strictly blind to computer vision values
          </p>
        </div>

        <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          <span>Blind Protocol Enforced</span>
        </div>
      </div>

      {submitted ? (
        <div className="p-8 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white text-center shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-[var(--vt-ink,#1F1C18)] mb-1">
            Readings Saved &amp; Locked
          </h2>
          <p className="text-xs text-[var(--vt-ink-muted,#5C554C)] mb-6">
            Participant {participantCode}, Reading {readingNo} by Measurer {measurerCode} has been permanently written to research audit.
          </p>
          <Button
            onClick={() => {
              setSubmitted(false);
              setReadingNo(readingNo === 1 ? 2 : 1);
            }}
          >
            Enter Next Reading
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Participant code and reading selector */}
          <div className="grid grid-cols-2 gap-4 p-5 rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white shadow-2xs">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Participant Code
              </label>
              <input
                type="text"
                value={participantCode}
                onChange={(e) => setParticipantCode(e.target.value.toUpperCase())}
                className="w-full h-11 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] font-mono font-bold text-base"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[var(--vt-ink-muted,#5C554C)] block mb-1">
                Reading Number
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[1, 2].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setReadingNo(num as any)}
                    className={`h-11 rounded-xl border text-xs font-bold cursor-pointer ${
                      readingNo === num
                        ? 'bg-[var(--vt-thread,#2E3A87)] text-white'
                        : 'border-[var(--vt-line,#DDD5C8)] hover:bg-[#FAF8F5]'
                    }`}
                  >
                    Reading {num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 9 Tape Reading Inputs in Appendix C Order */}
          <div className="rounded-2xl border border-[var(--vt-line,#DDD5C8)] bg-white divide-y divide-[var(--vt-line,#DDD5C8)]/50 shadow-2xs overflow-hidden">
            {siteList.map((item) => {
              const val = values[item.code] || '';
              return (
                <div key={item.code} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#FAF8F5]">
                  <div>
                    <label className="text-sm font-bold text-[var(--vt-ink,#1F1C18)] block">
                      {item.label}
                    </label>
                    <span className="text-xs text-[var(--vt-ink-muted,#5C554C)]">
                      {item.desc}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <input
                      type="number"
                      step="0.1"
                      value={val}
                      onChange={(e) => handleValChange(item.code, e.target.value)}
                      required
                      className="w-24 h-10 px-3 rounded-xl border border-[var(--vt-line,#DDD5C8)] text-right font-mono font-bold text-sm"
                    />
                    <span className="text-xs text-[var(--vt-ink-muted,#5C554C)] w-6">cm</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Button type="submit" size="xl" loading={submitting} className="w-full">
            Submit &amp; Lock Reference Tape Readings
          </Button>
        </form>
      )}
    </div>
  );
};
