import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { firefox } from 'playwright';
import { atomicJson, readControl, readJson, writeControl } from '../scripts/lib/crawl-state.mjs';

async function browserPath() {
  if (process.env.FIREFOX_EXECUTABLE_PATH) {
    if (!existsSync(process.env.FIREFOX_EXECUTABLE_PATH)) throw new Error('Không tìm thấy Firefox ở FIREFOX_EXECUTABLE_PATH.');
    return process.env.FIREFOX_EXECUTABLE_PATH;
  }
  if (existsSync(firefox.executablePath())) return firefox.executablePath();
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright');
  for (const entry of (await readdir(cache).catch(() => [])).filter(name => /^firefox-\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const path = join(cache, entry, 'firefox', 'firefox');
    if (existsSync(path)) return path;
  }
  throw new Error('Chưa có Firefox. Chạy: bunx playwright install firefox');
}

export function createCrawlProcess({ directory = resolve('.local-data'), root = process.cwd(), workerPath = resolve(root, 'scripts/crawl-public.mjs'), resolveBrowser = browserPath } = {}) {
  let childPid = null;
  let queue = Promise.resolve();
  async function isWorker(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      const args = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      const cwd = await readlink(`/proc/${pid}/cwd`);
      return cwd === root && args.some(arg => arg === workerPath || resolve(root, arg) === workerPath);
    } catch { return false; }
  }
  async function inspect() {
    const lock = Number(await readFile(join(directory, 'crawl.lock'), 'utf8').catch(() => '0'));
    const status = await readJson(join(directory, 'status.json'), null);
    let pid = null;
    for (const candidate of [childPid, lock, status?.pid]) if (await isWorker(candidate)) { pid = candidate; break; }
    const lifecycle = await readJson(join(directory, 'lifecycle.json'), {});
    return { alive: pid !== null, pid, stopping: pid !== null && lifecycle.stopRequested === true };
  }
  function serial(action) {
    const result = queue.catch(() => {}).then(action);
    queue = result;
    return result;
  }
  return {
    inspect,
    start: () => serial(async () => {
      const existing = await inspect();
      if (existing.alive) {
        if (existing.stopping) throw new Error('Crawler đang dừng. Đợi tiến trình dừng xong rồi bấm Start.');
        await writeControl(directory, { ...await readControl(directory), paused: false });
        return { ...existing, alreadyRunning: true };
      }
      const executable = await resolveBrowser();
      await mkdir(directory, { recursive: true });
      await writeControl(directory, { ...await readControl(directory), paused: false });
      await atomicJson(join(directory, 'lifecycle.json'), { stopRequested: false });
      const log = await open(join(directory, 'crawl.log'), 'a');
      let child;
      try {
        child = spawn(process.execPath, [workerPath], {
          cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd],
          env: { ...process.env, ...(executable ? { FIREFOX_EXECUTABLE_PATH: executable } : {}) },
        });
        await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); });
      } finally { await log.close(); }
      childPid = child.pid;
      child.once('exit', () => { if (childPid === child.pid) childPid = null; });
      child.unref();
      await new Promise(accept => setTimeout(accept, 500));
      if (!await isWorker(child.pid)) throw new Error('Crawler không khởi động được. Kiểm tra .local-data/crawl.log.');
      return { alive: true, pid: child.pid, stopping: false, alreadyRunning: false };
    }),
    stop: () => serial(async () => {
      const existing = await inspect();
      if (existing.alive) await atomicJson(join(directory, 'lifecycle.json'), { stopRequested: true, requestedAt: new Date().toISOString() });
      return { ...existing, stopping: existing.alive };
    }),
  };
}
