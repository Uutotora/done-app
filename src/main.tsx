import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './index.css';
import { App } from './App';
import { useData } from './lib/store';
import { useUI } from './lib/ui';

if (import.meta.env.DEV) {
  // Handy for debugging and e2e scripts: window.__done.getState()
  Object.assign(window, { __done: useData, __ui: useUI });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
