import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import search from './api/search.js';
import { createCrawlApi } from './server/crawl-api.js';

function localSearchApi() {
  const configure = (server) => {
    const crawlApi = createCrawlApi();
    server.middlewares.use('/api/crawl', (req, res, next) => {
      if (req.url?.split('?')[0] !== '/') return next();
      crawlApi(req, res).catch(next);
    });
    server.middlewares.use('/api/search', (req, res, next) => {
    if (req.url?.split('?')[0] !== '/') return next();
    req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    search(req, res).catch(next);
    });
  };
  return { name: 'local-search-api', configureServer: configure, configurePreviewServer: configure };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['SEARCH_SOURCE', 'OFFICIAL_DATA_PATH', 'SHEETS_API_URL', 'SHEETS_API_TOKEN']) {
    if (env[key] !== undefined && process.env[key] === undefined) process.env[key] = env[key];
  }
  return { plugins: [react(), tailwindcss(), localSearchApi()], server: { port: 5173 } };
});
