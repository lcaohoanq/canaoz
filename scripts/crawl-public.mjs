import { firefox } from 'playwright';
import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicJson, readControl, readJson, writeControl } from './lib/crawl-state.mjs';
import { createCrawlPool } from './lib/crawl-pool.mjs';
import { createCrawlStore } from './lib/crawl-store.mjs';
import { createBrowserWorker } from './lib/crawl-browser.mjs';
import { createTargetReader } from './lib/crawl-targets.mjs';

const origin = 'https://tracuu.srofptuhcm.com/';
const directory = resolve('.local-data');
await mkdir(directory, { recursive: true });
const lockPath = resolve(directory, 'crawl.lock');
try {
  const lock = await open(lockPath, 'wx');
  await lock.writeFile(String(process.pid)); await lock.close();
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const pid = Number(await readFile(lockPath, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid crawler lock; inspect crawl.lock.');
  try { process.kill(pid, 0); throw new Error(`Crawler ${pid} is already running.`); }
  catch (running) { if (running.code !== 'ESRCH') throw running; }
  await unlink(lockPath);
  const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close();
}
let browser, pool, store, control, targets;
const readTargets = createTargetReader();
let stopping = false;
let failure = null;
const events = [];
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
function addEvent(message) {
  events.push({ at: new Date().toISOString(), message });
  if (events.length > 20) events.shift();
  console.log(message);
}
async function saveStatus() {
  await atomicJson(resolve(directory, 'status.json'), {
    ...(pool?.snapshot() ?? { state: 'stopped' }),
    ...(failure ? { error: failure.message, lastError: { at: new Date().toISOString(), studentId: null, message: failure.message } } : {}),
    heartbeatAt: new Date().toISOString(), pid: process.pid, control, events, source: targets?.summary,
  });
}
const tickDelay = () => new Promise(accept => setTimeout(accept, 250));
try {
  targets = await readTargets();
  if (!targets) throw new Error('Không có file .xlsx trong data. Thêm danh sách MSSV trước khi chạy crawler.');
  addEvent(`Excel: ${targets.summary.total} MSSV duy nhất, đã loại ${targets.summary.duplicates} lượt trùng.`);
  store = await createCrawlStore(directory, origin);
  const stored = await readJson(resolve(directory, 'control.json'), {});
  control = await writeControl(directory, {
    ...stored,
    concurrency: stored.concurrency ?? Number(process.env.CRAWL_CONCURRENCY ?? 2),
    rangeStart: stored.rangeStart ?? Number(process.env.CRAWL_START ?? 0),
    rangeEnd: stored.rangeEnd ?? Number(process.env.CRAWL_END ?? 99),
    prefixes: stored.prefixes ?? (process.env.CRAWL_PREFIXES ?? 'SE18,SS18,SE17,SS17').split(','),
    delayMs: stored.delayMs ?? Number(process.env.CRAWL_DELAY_MS ?? 10000),
  });
  pool = createCrawlPool({ control, targetIds: targets.ids, completed: store.completed, persist: store.save, onEvent: addEvent,
    createWorker: () => createBrowserWorker(browser, { origin, directory }) });
  await store.snapshot();
  await saveStatus();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  const proxy = proxyUrl ? (() => { const u = new URL(proxyUrl); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; })() : undefined;
  browser = await firefox.launch({ headless: true, proxy, executablePath: process.env.FIREFOX_EXECUTABLE_PATH || undefined });
  let nextRefresh = 0;
  let nextStatus = 0;
  while (!pool.settled) {
    if (Date.now() >= nextRefresh) {
      const lifecycle = await readJson(resolve(directory, 'lifecycle.json'), {});
      stopping ||= lifecycle.stopRequested === true;
      control = await readControl(directory);
      targets = await readTargets();
      if (!targets) throw new Error('Không còn file .xlsx trong data.');
      pool.setTargets(targets.ids);
      nextRefresh = Date.now() + 1000;
    }
    pool.tick(control, stopping);
    if (Date.now() >= nextStatus) { await saveStatus(); nextStatus = Date.now() + 1000; }
    await tickDelay();
  }
  if (pool.failure) process.exitCode = 1;
} catch (error) {
  failure = error;
  addEvent(`Stopped: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Drain lookups and queued writes before releasing the single coordinator lock.
  pool?.stop(failure);
  try {
    while (pool && !pool.settled) { pool.tick(control, true); await tickDelay(); }
    await store?.snapshot();
    await saveStatus();
  } finally {
    try { await browser?.close(); }
    finally { await unlink(lockPath); }
  }
}
