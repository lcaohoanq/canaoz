import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import CrawlDashboard from './CrawlDashboard.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/$/, '') === '/crawl' ? <CrawlDashboard /> : <App />}
  </React.StrictMode>
);
