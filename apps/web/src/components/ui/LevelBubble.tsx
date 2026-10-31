import React from 'react';
import { Check } from 'lucide-react';
import { CAPTURE_CONFIG } from '../../capture/config';

interface LevelBubbleProps {
  beta: number; // 88..92 is level
  gamma: number; // -2..2 is level
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LevelBubble: React.FC<LevelBubbleProps> = ({
  beta,
  gamma,
  size = 'md',
  className = '',
}) => {
  // Level condition per C1
  const isLevel = beta >= 88 && beta <= 92 && Math.abs(gamma) <= CAPTURE_CONFIG.level.gammaMax;

  // Calculate pixel offset from center
  // Normal beta is 90. Delta = beta - 90
  const deltaBeta = Math.max(-15, Math.min(15, beta - 90));
  const deltaGamma = Math.max(-15, Math.min(15, gamma));

  const dim = size === 'sm' ? 64 : size === 'lg' ? 120 : 96;
  const bubbleDim = size === 'sm' ? 18 : size === 'lg' ? 28 : 22;

  // Max translation radius in container
  const maxRadius = (dim - bubbleDim) / 2 - 4;
  const offsetX = (deltaGamma / 15) * maxRadius;
  const offsetY = (deltaBeta / 15) * maxRadius;

  return (
    <div className={`flex flex-col items-center gap-1.5 ${className}`}>
      <div
        style={{ width: dim, height: dim }}
        className={`relative rounded-full border-2 flex items-center justify-center transition-colors shadow-inner ${
          isLevel
            ? 'border-emerald-500 bg-emerald-500/10'
            : 'border-amber-500/60 bg-black/40'
        }`}
      >
        {/* Crosshair guide lines */}
        <div className="absolute inset-x-2 h-[1px] bg-white/20" />
        <div className="absolute inset-y-2 w-[1px] bg-white/20" />

        {/* Center Target Ring */}
        <div
          style={{ width: bubbleDim + 8, height: bubbleDim + 8 }}
          className={`rounded-full border border-dashed transition-colors flex items-center justify-center ${
            isLevel ? 'border-emerald-400 bg-emerald-500/20' : 'border-white/30'
          }`}
        >
          {isLevel && <Check className="w-4 h-4 text-emerald-400 stroke-[3]" />}
        </div>

        {/* Floating Spirit Bubble */}
        <div
          style={{
            width: bubbleDim,
            height: bubbleDim,
            transform: `translate(${offsetX}px, ${offsetY}px)`,
          }}
          className={`absolute rounded-full shadow-md transition-transform duration-75 flex items-center justify-center ${
            isLevel
              ? 'bg-emerald-400 text-emerald-950 ring-2 ring-emerald-300'
              : 'bg-amber-400 text-amber-950 ring-1 ring-white/50'
          }`}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-white/70" />
        </div>
      </div>

      <div className="text-[11px] font-mono text-center opacity-90 tabular-nums">
        <span className={beta >= 88 && beta <= 92 ? 'text-emerald-400 font-bold' : 'text-amber-300'}>
          Tilt: {beta.toFixed(1)}°
        </span>
        <span className="mx-1 text-white/40">·</span>
        <span className={Math.abs(gamma) <= CAPTURE_CONFIG.level.gammaMax ? 'text-emerald-400 font-bold' : 'text-amber-300'}>
          Roll: {gamma.toFixed(1)}°
        </span>
      </div>
    </div>
  );
};
