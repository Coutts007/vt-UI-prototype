// Tones, recorded clips and the speech fallback (A3). Clips first; speech only when a clip is missing.
import { MessageKey, messageText } from './messages';

type Locale = 'en' | 'sw';
export type ToneName = 'pass' | 'chime' | 'beep' | 'beepLong' | 'stop' | 'done';

const TONES: Record<ToneName, { freqs: number[]; gap: number; length: number; wave?: OscillatorType }> = {
  pass: { freqs: [1200], gap: 0, length: 0.06 },
  chime: { freqs: [523, 659, 784], gap: 0.08, length: 0.3 },
  beep: { freqs: [880], gap: 0, length: 0.12 },
  beepLong: { freqs: [1320], gap: 0, length: 0.35 },
  stop: { freqs: [330, 220], gap: 0.12, length: 0.2, wave: 'sawtooth' },
  done: { freqs: [659, 880, 1047], gap: 0.1, length: 0.4 },
};

const MUTE_KEY = 'vt_audio_muted';

export interface AudioPort {
  say(key: MessageKey, options?: { interrupt?: boolean }): void;
  sayAll(keys: MessageKey[]): void;
  tone(name: ToneName): void;
  stop(): void;
}

/** Plays one message at a time, queues the rest, and falls back to speech when a clip fails. */
export class VoiceGuide implements AudioPort {
  private ctx: AudioContext | null = null;
  private element: HTMLAudioElement | null = null;
  private queue: MessageKey[] = [];
  private playing = false;
  private muted = false;
  /** What was asked for, in order. Dev and tests read it to prove the flow works by ear alone. */
  readonly spoken: MessageKey[] = [];
  private locale: () => Locale = () => 'en';

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === 'true';
    } catch {
      // Private mode: stay unmuted.
    }
  }

  setLocaleSource(source: () => Locale): void {
    this.locale = source;
  }

  getMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
    try {
      localStorage.setItem(MUTE_KEY, String(muted));
    } catch {
      // Not saved; it still applies now.
    }
  }

  /** Must run inside a tap (iOS autoplay rule, 10.6). */
  unlock(): void {
    this.audioContext();
    this.element ??= new Audio();
  }

  private audioContext(): AudioContext | null {
    if (typeof window === 'undefined' || !window.AudioContext) return null;
    this.ctx ??= new window.AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  tone(name: ToneName): void {
    if (this.muted) return;
    const ctx = this.audioContext();
    if (!ctx) return;
    const { freqs, gap, length, wave } = TONES[name];
    freqs.forEach((freq, index) => {
      const start = ctx.currentTime + index * gap;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      if (wave) osc.type = wave;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.14, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length);
    });
  }

  say(key: MessageKey, options: { interrupt?: boolean } = {}): void {
    this.spoken.push(key);
    if (this.muted) return;
    if (options.interrupt) this.stop();
    this.queue.push(key);
    this.pump();
  }

  sayAll(keys: MessageKey[]): void {
    keys.forEach((key, index) => this.say(key, { interrupt: index === 0 }));
  }

  stop(): void {
    this.queue = [];
    this.playing = false;
    if (this.element) {
      this.element.onended = null;
      this.element.onerror = null;
      this.element.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  private pump(): void {
    if (this.playing) return;
    const key = this.queue.shift();
    if (!key) return;
    this.playing = true;
    const locale = this.locale();
    const next = () => {
      this.playing = false;
      this.pump();
    };
    this.element ??= new Audio();
    const audio = this.element;
    let fellBack = false;
    const fallback = () => {
      if (fellBack) return;
      fellBack = true;
      audio.onended = null;
      audio.onerror = null;
      this.speak(key, locale, next);
    };
    audio.onended = next;
    audio.onerror = fallback;
    audio.src = `/audio/${locale}/${key}.mp3`;
    const started = audio.play();
    if (started) started.catch(fallback);
  }

  /** The fallback. Without a voice for the language it stays silent and the flow carries on. */
  private speak(key: MessageKey, locale: Locale, done: () => void): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      done();
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang.toLowerCase().startsWith(locale));
    if (voices.length && !voice) {
      done();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(messageText(key, locale));
    utterance.lang = locale === 'sw' ? 'sw-KE' : 'en-KE';
    if (voice) utterance.voice = voice;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  }
}

export const voiceGuide = new VoiceGuide();

if (typeof window !== 'undefined' && (import.meta.env.DEV || import.meta.env.MODE === 'mock')) {
  (window as unknown as { __vtSpoken: MessageKey[] }).__vtSpoken = voiceGuide.spoken;
}
