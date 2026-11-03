// Every Kiswahili string is in the review register (frontend-spec 16, M16). The register is
// git-ignored on the public repository (D30), so the check runs only where the file exists.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sw } from '../../src/i18n/sw';
import { adminSw } from '../../src/views/admin/adminText';
import { panelSw } from '../../src/views/tailor/directoryPanelText';
import { tailorSw } from '../../src/views/tailor/tailorText';

const REGISTER = join(import.meta.dirname, '../../../../docs/i18n-review.md');

function registeredKeys(text: string) {
  // A table row `| key | ... |`, a backticked `key`, or a backticked glob such as `corr*Short`.
  const rows = [...text.matchAll(/^\| (\w+) \|/gm)].map((m) => m[1]);
  const words = [...text.matchAll(/`([\w*]+)`/g)].map((m) => m[1]);
  const exact = new Set([...rows, ...words.filter((w) => !w.includes('*'))]);
  const globs = words
    .filter((w) => w.includes('*'))
    .map((w) => new RegExp(`^${w.replace(/\*/g, '.*')}$`));
  return (key: string) => exact.has(key) || globs.some((g) => g.test(key));
}

describe.skipIf(!existsSync(REGISTER))('the Kiswahili review register', () => {
  const text = readFileSync(REGISTER, 'utf8');
  const registered = registeredKeys(text);

  it('lists every key of the shared dictionary', () => {
    expect(Object.keys(sw).filter((key) => !registered(key))).toEqual([]);
  });

  // A screen dictionary is registered key by key, or module by module ("all strings in ...
  // are drafts"), in which case the register names the module file.
  it.each([
    ['apps/web/src/views/tailor/tailorText.ts', tailorSw],
    ['apps/web/src/views/admin/adminText.ts', adminSw],
    ['apps/web/src/views/tailor/directoryPanelText.ts', panelSw],
  ])('covers %s', (file, dictionary) => {
    expect(Object.keys(dictionary).length).toBeGreaterThan(0);
    if (text.includes(`\`${file}\``)) return;
    expect(Object.keys(dictionary).filter((key) => !registered(key))).toEqual([]);
  });
});
