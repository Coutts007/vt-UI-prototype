#!/usr/bin/env node
// Generates the PLACEHOLDER voice clips and the message script from messages.json (A3).
// The voice is ffmpeg's flite, an English synthetic voice, so the Kiswahili clips sound wrong
// by design until a native speaker records them. Never ship these as the final recording.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

const messages = JSON.parse(readFileSync('apps/web/src/capture/messages.json', 'utf8'));
const LIMIT = 15 * 1024;
const out = 'apps/web/public/audio';
const sizes = {};

for (const locale of ['en', 'sw']) {
  mkdirSync(`${out}/${locale}`, { recursive: true });
  for (const [key, text] of Object.entries(messages)) {
    const file = `${out}/${locale}/${key}.mp3`;
    const safe = text[locale].replace(/['":,\\]/g, ' ');
    for (const bitrate of ['24k', '16k', '12k', '8k']) {
      execFileSync('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `flite=text='${safe}':voice=slt`,
        '-ac',
        '1',
        '-ar',
        bitrate === '8k' ? '8000' : '16000',
        '-map_metadata',
        '-1',
        '-c:a',
        'libmp3lame',
        '-b:a',
        bitrate,
        file,
      ]);
      if (statSync(file).size <= LIMIT) break;
    }
    const size = statSync(file).size;
    if (size > LIMIT) throw new Error(`${file} is ${size} bytes, over the 15 KB limit`);
    sizes[`${locale}/${key}`] = size;
  }
}

writeFileSync(
  `${out}/manifest.json`,
  `${JSON.stringify({ placeholder: true, voice: 'ffmpeg flite slt (English synthetic voice)', status: 'OPEN: native-speaker recording' }, null, 2)}\n`,
);

const rows = Object.entries(messages)
  .map(([key, text]) => `| ${key} | ${text.en} | ${text.sw} |`)
  .join('\n');
writeFileSync(
  'docs/audio-script.md',
  `# Voice guidance script

**Status: OPEN.** The clips in \`apps/web/public/audio/{en,sw}/\` are placeholders made by a synthetic English voice. The Kiswahili clips are an English voice reading Kiswahili, so they are understandable at best. A native speaker must record every line below (decision D18). The Kiswahili text is an unreviewed draft.

To replace a clip, save it at the same path as \`<key>.mp3\`, 15 KB or less (mono, about 24 kbit/s). To change the words, edit \`apps/web/src/capture/messages.json\` and run \`node scripts/audio-placeholders.mjs\`, which regenerates the clips and this file.

| Key | English | Kiswahili (draft) |
|---|---|---|
${rows}
`,
);
console.log(
  `${Object.keys(sizes).length} clips, largest ${Math.max(...Object.values(sizes))} bytes`,
);
