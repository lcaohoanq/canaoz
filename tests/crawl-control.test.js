import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCrawlApi } from '../server/crawl-api.js';
import { atomicJson, readControl, validateControl, retryWait, defaults, planIds } from '../scripts/lib/crawl-state.mjs';

test('retry backoff grows, caps and respects server retry-after', () => {
  const control = validateControl({});
  assert.equal(retryWait(control, 1), 60000);
  assert.equal(retryWait(control, 3), 240000);
  assert.equal(retryWait(control, 10), 3600000);
  assert.equal(retryWait({ ...control, autoBackoff: false }, 3), 60000);
  assert.equal(retryWait(control, 1, 120000), 120000);
  assert.throws(() => validateControl({ delayMs: 1000 }));
  assert.throws(() => validateControl({ maxRetries: 11 }));
  for (const concurrency of [0, 5, 1.5, '2', null]) assert.throws(() => validateControl({ concurrency }));
  assert.equal(validateControl({}).concurrency, 2);
  assert.equal(validateControl({ concurrency: 4 }).concurrency, 4);
  assert.throws(() => validateControl({ paused: 'false' }));
  assert.throws(() => validateControl({ constructor: 'bad' }));
  assert.throws(() => validateControl({ rangeStart: 100, rangeEnd: 99 }));
  assert.throws(() => validateControl({ rangeEnd: 10000 }));
  assert.throws(() => validateControl({ prefixes: [] }));
  assert.throws(() => validateControl({ prefixes: ['SE18', 'SE18'] }));
  assert.throws(() => validateControl({ prefixes: ['SE19'] }));
});

test('expanding a plan retains completed IDs and only queues unchecked IDs', () => {
  const initial = planIds(validateControl({}));
  assert.equal(initial.length, 400);
  const completed = new Set(initial.slice(0, 241));
  const expanded = planIds(validateControl({ rangeEnd: 999 }));
  assert.equal(expanded.length, 4000);
  assert.equal(expanded.filter(id => completed.has(id)).length, 241);
  const pending = expanded.filter(id => !completed.has(id));
  assert.equal(pending.length, 3759);
  assert.equal(pending.includes('SE180000'), false);
  assert.equal(pending.includes('SE180100'), true);
  assert.equal(planIds(validateControl({ rangeEnd: 9999 })).length, 40000);
  assert.deepEqual(planIds(validateControl({ rangeStart: 98, rangeEnd: 100, prefixes: ['SS17'] })), ['SS170098', 'SS170099', 'SS170100']);
});

test('local API persists partial controls, reports stale worker and rejects invalid requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-control-'));
  const server = createServer(createCrawlApi(directory));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(base)).json()).status, null);
    assert.equal((await post({ concurrency: 4 })).status, 200);
    assert.equal((await readControl(directory)).concurrency, 4);
    assert.equal((await post({ concurrency: 5 })).status, 400);
    assert.equal((await post({ concurrency: 2 })).status, 200);
    assert.equal((await post({ delayMs: 20000, retryDelayMs: 120000 })).status, 200);
    assert.equal((await post({ paused: true })).status, 200);
    assert.deepEqual(await readControl(directory), { ...defaults, delayMs: 20000, retryDelayMs: 120000, paused: true });
    assert.equal((await post({ rangeEnd: 999 })).status, 200);
    assert.equal((await readControl(directory)).rangeEnd, 999);
    assert.equal((await post({ rangeStart: 1000 })).status, 400);
    assert.equal((await readControl(directory)).rangeStart, 0);
    assert.equal((await post({ delayMs: 0 })).status, 400);
    assert.equal((await readControl(directory)).delayMs, 20000);
    assert.equal((await post({ paused: false }, { Origin: 'https://unrelated.example' })).status, 403);
    const rejectedHost = await new Promise((resolve, reject) => {
      const req = request(base, { headers: { Host: 'remote.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(rejectedHost, 403);
    assert.equal((await post({ paused: false }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await fetch(base, { method: 'DELETE' })).status, 405);
    await atomicJson(join(directory, 'status.json'), { state: 'running', heartbeatAt: new Date(Date.now() - 60000).toISOString(), checked: 10, found: 2 });
    assert.equal((await (await fetch(base)).json()).stale, true);
    await atomicJson(join(directory, 'status.json'), { state: 'complete', heartbeatAt: new Date(Date.now() - 60000).toISOString() });
    assert.equal((await (await fetch(base)).json()).stale, true);
    await atomicJson(join(directory, 'status.json'), { state: 'running', heartbeatAt: new Date().toISOString(), checked: 10, found: 2 });
    assert.equal((await (await fetch(base)).json()).stale, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
