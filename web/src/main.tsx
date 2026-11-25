import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ServerStatus from './ServerStatus';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServerStatus />
    <App />
  </StrictMode>,
);
