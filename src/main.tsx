import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces/full.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/todo.css';
import './styles/calendar.css';
import './styles/forms.css';
import { initTelegram } from './lib/telegram';
import App from './App';

initTelegram();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
