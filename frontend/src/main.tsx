import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './boot';
import { initTheme } from './theme';
import './styles.css';
import './compare.css';

initTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Session -> (login screen) -> workspace -> socket -> connection login.
void boot();
