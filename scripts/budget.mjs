#!/usr/bin/env node
// Checks the built web app against frontend-spec 18. Run after a production build.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = process.argv[2] ?? 'apps/web/dist';
const assets = join(dist, 'assets');
const KB = 1024;
const size = (name) => gzipSync(readFileSync(join(assets, name))).length;
const failures = [];

if (existsSync(join(dist, 'mockServiceWorker.js')))
  failures.push('mockServiceWorker.js is in the build');

for (const name of readdirSync(assets)) {
  if (
    name.endsWith('.js') &&
    /mockServiceWorker|setupWorker/.test(readFileSync(join(assets, name), 'utf8'))
  ) {
    failures.push(`mock code is in ${name}`);
  }
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const files = readdirSync(assets);
const entry = [...html.matchAll(/assets\/([^"]+\.js)/g)].map((m) => m[1]);

// Walks static imports only, so screens loaded on demand count against their own area.
function closure(names) {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name) || !files.includes(name)) return;
    seen.add(name);
    const code = readFileSync(join(assets, name), 'utf8');
    for (const m of code.matchAll(/(?:from|import)\s*["']\.\/([^"']+\.js)["']/g)) walk(m[1]);
  };
  names.forEach(walk);
  return seen;
}

const shell = closure(entry);
const screen = (prefix) => {
  const found = files.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.js'));
  if (!found.length) failures.push(`no chunk found for ${prefix}`);
  return found;
};
const total = (names) => [...names].reduce((sum, n) => sum + size(n), 0);

const clientScreens = [
  'WelcomeView',
  'StartView',
  'ConsentView',
  'PhoneCheckView',
  'SheetGuideView',
  'PhoneSetupView',
  'CaptureView',
  'ProcessingView',
  'ReviewView',
  'SavedView',
  'MyMeasurementsView',
  'HelpView',
  'PrivacyView',
  'DeclinedView',
];
const tailorScreens = [
  'TailorLayout',
  'ClientListView',
  'OrderQueueView',
  'NewOrderView',
  'OrderDetailView',
  'ProfileDetailView',
];
const firstScreen = closure([...shell, ...screen('WelcomeView')]);
const client = closure([...shell, ...clientScreens.flatMap(screen)]);
// Each person downloads one language (D35). Count the larger, so the figures stay honest.
const dictionary = Math.max(...['en', 'sw'].flatMap(screen).map(size));
const tailor = closure([...shell, ...tailorScreens.flatMap(screen)]);
const css = files.filter((f) => f.endsWith('.css'));

const checks = [
  ['client first screen JS', total(firstScreen) + dictionary, 120 * KB],
  // Known deviation D34: React plus Dexie leave too little of the 120 KB for the whole flow.
  // This limit only stops growth. Lower it as the prototype's mock client leaves the bundle.
  ['client whole flow JS (deviation D34, target 120 KB)', total(client) + dictionary, 170 * KB],
  ['tailor JS', total(tailor) + dictionary, 200 * KB],
  ['CSS', total(css), 25 * KB],
];
for (const [name, actual, limit] of checks) {
  console.log(`${name}: ${(actual / KB).toFixed(1)} KB gzip (limit ${limit / KB} KB)`);
  if (actual > limit) failures.push(`${name} is over budget`);
}

// The directory (D27) loads on demand from its own route, so it is outside the client flow's count.
// Reported, not hidden: a person who opens it downloads this on top.
const directory = files.filter((f) => /^BusinessDirectoryView-.*\.js$/.test(f));
if (directory.length) {
  const own = [...closure(directory)].filter((f) => !client.has(f));
  console.log(`directory screen JS, on demand: ${(total(own) / KB).toFixed(1)} KB gzip`);
}

let firstLoad = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else firstLoad += statSync(path).size;
  }
};
walk(dist);
console.log(`whole build: ${(firstLoad / KB / KB).toFixed(1)} MB (limit 30 MB)`);
if (firstLoad > 30 * KB * KB) failures.push('build is over 30 MB');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
