import { readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// MSW's worker must never reach a production build.
function dropMockWorker(mockMode: boolean): Plugin {
  return {
    name: 'vt-drop-mock-worker',
    apply: 'build',
    async closeBundle() {
      if (!mockMode)
        await rm(resolve(import.meta.dirname, 'dist/mockServiceWorker.js'), { force: true });
    },
  };
}

// Client and sign-in screens work offline. Tailor, admin and study code never reaches a client's phone.
const ONLINE_ONLY =
  /^assets\/(Tailor|Client(List|Detail)|NewClientCode|ProfileDetail|OrderQueue|NewOrder|OrderDetail|OrderSheet|Conflicts|Audit|Admin|Study|BusinessDirectory)/;

function precacheList(): Plugin {
  return {
    name: 'vt-precache-list',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/') && !ONLINE_ONLY.test(name))
        .sort()
        .map((name) => `/${name}`);
      // The voice clips and the sheet must work offline (A3). Public files are not in the bundle.
      const publicDir = resolve(import.meta.dirname, 'public');
      for (const locale of ['en', 'sw']) {
        for (const clip of readdirSync(resolve(publicDir, 'audio', locale)).sort()) {
          files.push(`/audio/${locale}/${clip}`);
        }
      }
      files.push('/vt-measuring-sheet-A4.pdf');
      const version = createHash('sha256').update(files.join()).digest('hex').slice(0, 12);
      const worker = bundle['sw.js'];
      if (worker?.type === 'chunk') {
        worker.code = worker.code.replace('__VT_PRECACHE__', [version, ...files].join());
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const envDir = resolve(import.meta.dirname, '../..');
  const mockMode =
    mode === 'mock' ||
    loadEnv(mode, envDir, 'VITE_').VITE_API_MODE === 'mock' ||
    process.env.VITE_API_MODE === 'mock';
  return {
    envDir,
    plugins: [react(), tailwindcss(), dropMockWorker(mockMode), precacheList()],
    server: {
      proxy: { '/api': process.env.VT_API_PROXY ?? 'http://localhost:8000' },
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, 'index.html'),
          sw: resolve(import.meta.dirname, 'src/sw/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
    test: {
      include: ['tests/unit/**/*.test.{ts,tsx}'],
    },
  };
});
