import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeApp } from './native/NativeApp';
import { setBackend } from './lib/api';
import { bootstrapSession } from './lib/auth';
import { wmBackend } from './ext/wm';
import './styles/fonts';
import './styles/base.css';
import './styles/app.css';
import './styles/screens.css';
import { applyTheme } from './lib/theme';

applyTheme();

// The client on wiki-masters.com, playing on their servers. The loader (extension/loader.js) has
// already replaced their page with #root.
setBackend(wmBackend);
bootstrapSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NativeApp />
  </StrictMode>,
);
