import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { loadLocale, savedLocale } from './i18n';
import './index.css';

async function start() {
  if (import.meta.env.VITE_API_MODE === 'mock') {
    const { startMockWorker } = await import('../mocks/browser');
    await startMockWorker();
  }
  await loadLocale(savedLocale());
  createRoot(document.getElementById('root')!).render(<App />);
}

void start();
