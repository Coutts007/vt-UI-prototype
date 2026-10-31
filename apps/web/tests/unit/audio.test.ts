// A3: clips first, speech only when a clip is missing, mute respected, one voice at a time.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceGuide } from '../../src/capture/audio';
import { MESSAGE_KEYS, messageText } from '../../src/capture/messages';

class FakeAudio {
  static played: string[] = [];
  static missing = false;
  static instances: FakeAudio[] = [];
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  pause() {}
  play() {
    if (FakeAudio.missing) return Promise.reject(new Error('missing'));
    FakeAudio.played.push(this.src);
    return Promise.resolve();
  }
}

const utterances: { text: string; lang: string; onend?: () => void }[] = [];

beforeEach(() => {
  FakeAudio.played = [];
  FakeAudio.missing = false;
  FakeAudio.instances = [];
  utterances.length = 0;
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = '';
      onend?: () => void;
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal('window', {
    speechSynthesis: {
      getVoices: () => [],
      cancel: () => {},
      speak: (u: (typeof utterances)[number]) => utterances.push(u),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('VoiceGuide', () => {
  it('plays the clip for the language', () => {
    const guide = new VoiceGuide();
    guide.setLocaleSource(() => 'sw');
    guide.say('good');
    expect(FakeAudio.played).toEqual(['/audio/sw/good.mp3']);
    expect(utterances).toEqual([]);
  });

  it('queues messages, one at a time', () => {
    const guide = new VoiceGuide();
    guide.say('n3');
    guide.say('n2');
    expect(FakeAudio.played).toEqual(['/audio/en/n3.mp3']);
    FakeAudio.instances[0].onended!();
    expect(FakeAudio.played).toEqual(['/audio/en/n3.mp3', '/audio/en/n2.mp3']);
  });

  it('interrupt drops what was waiting', () => {
    const guide = new VoiceGuide();
    guide.say('n3');
    guide.say('n2');
    guide.say('done', { interrupt: true });
    expect(FakeAudio.played.at(-1)).toBe('/audio/en/done.mp3');
    FakeAudio.instances[0].onended?.();
    expect(FakeAudio.played).not.toContain('/audio/en/n2.mp3');
  });

  it('falls back to speech when the clip is missing', async () => {
    FakeAudio.missing = true;
    const guide = new VoiceGuide();
    guide.setLocaleSource(() => 'sw');
    guide.say('done');
    await flush();
    expect(utterances[0].text).toBe(messageText('done', 'sw'));
    expect(utterances[0].lang).toBe('sw-KE');
  });

  it('stays silent, and carries on, when no voice fits the language', async () => {
    FakeAudio.missing = true;
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => [{ lang: 'en-US' }],
        cancel: () => {},
        speak: (u: (typeof utterances)[number]) => utterances.push(u),
      },
    });
    const guide = new VoiceGuide();
    guide.setLocaleSource(() => 'sw');
    guide.say('n1');
    guide.say('n2');
    await flush();
    await flush();
    expect(utterances).toEqual([]);
  });

  it('a muted clip does not count as spoken', () => {
    const guide = new VoiceGuide();
    guide.setMuted(true);
    guide.say('good');
    expect(FakeAudio.played).toEqual([]);
    expect(guide.spoken).toEqual([]);
  });

  it('a clip that really plays counts as spoken, and a missing one with no voice does not', async () => {
    const guide = new VoiceGuide();
    guide.say('good');
    await flush();
    expect(guide.spoken).toEqual(['good']);
    FakeAudio.missing = true;
    const quiet = new VoiceGuide();
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [{ lang: 'de-DE' }],
      speak() {},
      cancel() {},
    });
    quiet.say('good');
    await flush();
    expect(quiet.spoken).toEqual([]);
  });
});

describe('placeholder clips and the script', () => {
  const script = readFileSync('../../docs/audio-script.md', 'utf8');

  it.each(MESSAGE_KEYS)('%s is in the script with both texts', (key) => {
    expect(script).toContain(`| ${key} | ${messageText(key, 'en')} | ${messageText(key, 'sw')} |`);
  });

  it.each(MESSAGE_KEYS.flatMap((key) => [`en/${key}`, `sw/${key}`]))(
    '%s.mp3 is at most 15 KB',
    (path) => {
      const file = `public/audio/${path}.mp3`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size).toBeLessThanOrEqual(15 * 1024);
    },
  );

  it('the clips are marked as placeholders', () => {
    const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8'));
    expect(manifest.placeholder).toBe(true);
    expect(script).toContain('OPEN');
  });
});
