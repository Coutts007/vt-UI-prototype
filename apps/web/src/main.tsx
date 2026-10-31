import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

async function start() {
  if (import.meta.env.VITE_API_MODE === 'mock') {
    const { startMockWorker } = await import('../mocks/browser');
    await startMockWorker();
  }
  createRoot(document.getElementById('root')!).render(<App />);
}

void start();
