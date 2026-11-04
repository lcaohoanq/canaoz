import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createCrawlProcess } from '../server/crawl-process.js';
import { createCrawlApi } from '../server/crawl-api.js';

async function until(check) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Worker lifecycle timed out');
}
test('start/stop API avoids duplicate workers and preserves checkpoint across restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canaoz-process-'));
  const workerPath = join(root, 'worker.mjs');
  await writeFile(join(root, 'crawl.ndjson'), 'existing checkpoint\n');
  await writeFile(workerPath, `
    import fs from 'node:fs/promises';
    await fs.writeFile('crawl.lock', String(process.pid));
    await fs.writeFile('status.json', JSON.stringify({pid:process.pid,state:'waiting',heartbeatAt:new Date().toISOString()}));
    const tick=setInterval(async()=>{
      const control=JSON.parse(await fs.readFile('lifecycle.json','utf8'));
      if(control.stopRequested){ clearInterval(tick); await fs.unlink('crawl.lock'); process.exit(0); }
    },50);
  `);
  const manager = createCrawlProcess({ root, directory: root, workerPath, resolveBrowser: async () => undefined });
  const server = createServer(createCrawlApi(root, manager));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = value => fetch(base, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(value)});
  try {
    assert.equal((await post({action:'unknown'})).status, 400);
    assert.equal((await post({action:'start',delayMs:3000})).status, 400);
    const [first, duplicate] = await Promise.all([post({action:'start'}), post({action:'start'})]);
    const a = await first.json(), b = await duplicate.json();
    assert.equal(a.ok,true); assert.equal(b.ok,true);
    assert.equal(a.worker.pid,b.worker.pid);
    assert.equal((await (await fetch(base)).json()).worker.alive,true);
    assert.equal((await post({action:'stop'})).status,200);
    await until(async()=>!(await manager.inspect()).alive);
    assert.equal(await readFile(join(root,'crawl.ndjson'),'utf8'),'existing checkpoint\n');
    const restarted = await (await post({action:'start'})).json();
    assert.equal(restarted.worker.alive,true);
    assert.notEqual(restarted.worker.pid,a.worker.pid);
    assert.equal(await readFile(join(root,'crawl.ndjson'),'utf8'),'existing checkpoint\n');
  } finally {
    await manager.stop();
    await until(async()=>!(await manager.inspect()).alive);
    await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
