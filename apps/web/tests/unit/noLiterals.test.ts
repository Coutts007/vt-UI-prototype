// Client screens must get every word from the dictionaries (A13), so both languages stay complete.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../src');
const CLIENT = readdirSync(join(ROOT, 'views/client'))
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => `views/client/${name}`);
const SHARED = [
  'CodeInput',
  'NumberInput',
  'SyncBadge',
  'FlagBadge',
  'Silhouette',
  'LevelBubble',
  'Header',
].map((name) => `components/ui/${name}.tsx`);

// Allowed text between tags: symbols and numbers only.
const WORD_IN_JSX = />\s*([A-Za-z][A-Za-z' ]{2,})\s*</g;
const WORD_IN_PROP = /\b(?:aria-label|title|placeholder|alt|label)="([A-Za-z][^"]*)"/g;

describe('client screens have no literal words', () => {
  for (const file of [...CLIENT, ...SHARED]) {
    it(file, () => {
      const code = readFileSync(join(ROOT, file), 'utf8');
      const found = [
        ...[...code.matchAll(WORD_IN_JSX)].map((m) => m[1].trim()),
        ...[...code.matchAll(WORD_IN_PROP)].map((m) => m[1]),
      ].filter((word) => !/^(Virtual Tailor|ISO)$/.test(word));
      // The tailor and admin menu items are migrated with their screens (M9 to M11, D27).
      if (file.endsWith('Header.tsx'))
        return expect(found.filter((word) => /^(Measure|Help|Privacy)$/.test(word))).toEqual([]);
      expect(found).toEqual([]);
    });
  }
});
