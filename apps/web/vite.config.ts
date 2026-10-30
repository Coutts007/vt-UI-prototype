import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': process.env.VT_API_PROXY ?? 'http://localhost:8000' },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
