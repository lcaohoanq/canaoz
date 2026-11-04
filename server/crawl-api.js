import { resolve } from 'node:path';
import { readControl, readJson, writeControl } from '../scripts/lib/crawl-state.mjs';
import { createCrawlProcess } from './crawl-process.js';
import { createTargetReader } from '../scripts/lib/crawl-targets.mjs';
import { readCrawlCheckpoint } from '../scripts/lib/crawl-store.mjs';

// Local Vite middleware only. A deployed Function cannot control this local worker.
export function createCrawlApi(directory = resolve('.local-data'), manager = createCrawlProcess({ directory })) {
  const readTargets = createTargetReader(resolve(directory, '../data'));
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    const host = req.headers.host;
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
    const address = req.socket?.remoteAddress;
    if (!host || !loopback.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return send(403, { ok: false, message: 'Trang quản lý chỉ dùng trên localhost.' });
    if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) {
      return send(403, { ok: false, message: 'Origin không hợp lệ.' });
    }
    try {
      if (req.method === 'POST') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(415, { ok: false, message: 'Cần gửi JSON.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) return send(413, { ok: false, message: 'Yêu cầu quá lớn.' });
        }
        let updates;
        try { updates = JSON.parse(body); } catch { return send(400, { ok: false, message: 'JSON không hợp lệ.' }); }
        if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return send(400, { ok: false, message: 'Cấu hình không hợp lệ.' });
        if (Object.hasOwn(updates, 'action')) {
          if (Object.keys(updates).length !== 1 || !['start', 'stop'].includes(updates.action)) return send(400, { ok: false, message: 'Action không hợp lệ.' });
          try { return send(200, { ok: true, worker: await manager[updates.action]() }); }
          catch (error) { return send(409, { ok: false, message: error.message }); }
        }
        try { return send(200, { ok: true, control: await writeControl(directory, { ...await readControl(directory), ...updates }) }); }
        catch (error) { return send(400, { ok: false, message: error.message }); }
      }
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET, POST'); return send(405, { ok: false, message: 'Method not allowed' }); }
      const status = await readJson(resolve(directory, 'status.json'), null);
      const control = await readControl(directory);
      const targets = await readTargets();
      let progress = null;
      if (targets && status?.source?.type !== 'sheets') {
        // Show existing checkpoint progress before the first run with Excel targets.
        const completed = await readCrawlCheckpoint(directory);
        const rows = targets.ids.map(id => completed.get(id)).filter(Boolean);
        progress = {
          planned: targets.ids.length, checked: rows.length, found: rows.filter(row => row.status === 'found').length,
          updatedAt: rows.reduce((latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest, null),
          groups: [...new Set(targets.ids.map(id => id.slice(0, 4)))].sort().map(prefix => ({ prefix,
            planned: targets.ids.filter(id => id.startsWith(prefix)).length,
            checked: rows.filter(row => row.studentId.startsWith(prefix)).length,
            found: rows.filter(row => row.studentId.startsWith(prefix) && row.status === 'found').length })),
        };
      }
      const age = status ? Math.max(0, Date.now() - Date.parse(status.heartbeatAt || status.updatedAt)) : null;
      const stale = Boolean(status && ['starting', 'running', 'waiting', 'retrying', 'paused', 'complete', 'stopping'].includes(status.state) && (!Number.isFinite(age) || age > 30000));
      return send(200, { ok: true, status, progress, source: targets?.summary ?? null, control, worker: await manager.inspect(), stale, heartbeatAgeSeconds: age === null ? null : Math.round(age / 1000), serverTime: new Date().toISOString() });
    } catch { return send(500, { ok: false, message: 'Không đọc được trạng thái crawler.' }); }
  };
}
