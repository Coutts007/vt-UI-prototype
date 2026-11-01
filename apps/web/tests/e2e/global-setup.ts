// Draws the synthetic camera clip before the browsers start. It is generated, never committed.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default function globalSetup(): void {
  const dir = resolve(import.meta.dirname, '../fixtures/video');
  if (existsSync(resolve(dir, 'generated/synth-front.y4m'))) return;
  execFileSync(
    process.execPath,
    [resolve(dir, 'make-synth-video.mjs'), resolve(dir, 'generated')],
    { stdio: 'inherit' },
  );
}
