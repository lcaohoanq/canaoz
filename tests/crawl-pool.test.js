import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCrawlPool } from '../scripts/lib/crawl-pool.mjs';
import { createCrawlStore } from '../scripts/lib/crawl-store.mjs';
import { validateControl } from '../scripts/lib/crawl-state.mjs';

const record = studentId => ({ studentId, status: 'found', name: 'Fixture', shift: 1, sessionLabel: 'Ca 1', fetchedAt: new Date().toISOString() });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};
function harness(options = {}) {
  let time = 0;
  let control = validateControl({ rangeEnd: 5, prefixes: ['SE18'], delayMs: 3000, retryDelayMs: 10000, ...options.control });
  const calls = [], saved = [], closed = [], created = [], captured = [];
  const completed = options.completed ?? new Map();
  const pool = createCrawlPool({ control, targetIds: options.targetIds, completed, now: () => time,
    persist: options.persist ?? (async item => { saved.push(item.studentId); }),
    createWorker: options.createWorker ?? (async id => {
      created.push(id);
      return {
        prepare: options.prepare,
        lookup(studentId, retryCount) {
          const result = deferred();
          calls.push({ workerId: id, studentId, retryCount, at: time, ...result, finish: () => result.resolve(record(studentId)) });
          return result.promise;
        },
        close: async () => { closed.push(id); },
        capture: async () => { captured.push(id); },
      };
    }),
  });
  async function pump() {
    // Flush session setup, preparation, lookup completion and close continuations.
    for (let i = 0; i < 4; i++) { pool.tick(control); await setImmediate(); }
  }
  return { pool, calls, saved, closed, created, captured, completed, pump,
    async advance(ms) { time += ms; await pump(); },
    async configure(value) { control = validateControl({ ...control, ...value }); await pump(); },
    async stop() { pool.stop(); await pump(); },
  };
}

test('Excel targets ignore numeric ranges, deduplicate, skip checkpoints and accept list updates without duplicate requests', async () => {
  const h = harness({
    targetIds: [' se183518 ', 'SE183518', 'DE180123', 'ss170023', 'SE63036'],
    completed: new Map([['SS170023', { studentId: 'SS170023', status: 'not_found' }]]),
  });
  await h.advance(3000); await h.advance(3000);
  assert.deepEqual(h.calls.map(call => call.studentId), ['SE183518', 'DE180123']);
  assert.equal(h.pool.snapshot().planned, 3);
  assert.equal(h.pool.snapshot().checked, 1);
  h.pool.setTargets(['DE180123', 'DE180123', 'QE180456', 'SS170023']);
  h.calls[0].finish(); h.calls[1].finish(); await h.pump();
  await h.advance(3000);
  assert.equal(h.calls.at(-1).studentId, 'QE180456');
  h.calls.at(-1).finish(); await h.pump();
  assert.equal(h.calls.length, 3);
  assert.equal(h.pool.snapshot().state, 'complete');
  assert.equal(h.pool.snapshot().planned, 3);
  assert.equal(h.pool.snapshot().checked, 3);
  assert.deepEqual(h.pool.snapshot().groups.map(group => [group.prefix, group.planned]), [['DE18', 1], ['QE18', 1], ['SS17', 1]]);
  h.pool.setTargets(['DE180123', 'QE180456', 'SS170023', 'HE180123']);
  await h.advance(3000);
  assert.equal(h.calls.at(-1).studentId, 'HE180123');
  h.calls.at(-1).finish(); await h.pump();
  assert.equal(h.pool.snapshot().checked, 4);
  await h.stop();
});

test('pool overlaps lookups, enforces one shared start interval and never claims an ID twice', async () => {
  const h = harness({ completed: new Map([['SE180000', record('SE180000')]]) });
  await h.pump();
  assert.equal(h.calls.length, 0);
  await h.advance(3000);
  await h.advance(3000);
  assert.deepEqual(h.calls.map(call => call.studentId), ['SE180001', 'SE180002']);
  assert.equal(h.pool.snapshot().activeIds.length, 2);
  await h.advance(3000);
  assert.equal(h.calls.length, 2);
  h.calls[0].finish();
  await h.pump();
  assert.equal(h.calls[2].studentId, 'SE180003');
  h.calls[1].finish(); h.calls[2].finish();
  await h.pump();
  await h.advance(3000); h.calls[3].finish(); await h.pump();
  await h.advance(3000); h.calls[4].finish(); await h.pump();
  assert.equal(h.pool.snapshot().state, 'complete');
  assert.equal(h.pool.snapshot().checked, 6);
  assert.equal(new Set(h.saved).size, 5);
  for (let i = 1; i < h.calls.length; i++) assert.ok(h.calls[i].at - h.calls[i - 1].at >= 3000);
  await h.stop();
  assert.equal(h.pool.settled, true);
});

test('HTTP backoff blocks the whole pool and respects Retry-After before retrying the same ID', async () => {
  const h = harness();
  await h.advance(3000);
  h.calls[0].reject(Object.assign(new Error('HTTP 429'), { retryable: true, globalCooldown: true, retryAfterMs: 20000 }));
  await h.pump();
  assert.equal(h.pool.snapshot().cooldownUntil, new Date(23000).toISOString());
  await h.advance(19999);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  assert.equal(h.calls[1].studentId, 'SE180001');
  await h.advance(3000);
  assert.equal(h.calls[2].studentId, h.calls[0].studentId);
  assert.equal(h.calls[2].retryCount, 1);
  await h.stop();
  h.calls[1].finish(); h.calls[2].finish(); await h.pump();
  assert.equal(h.pool.settled, true);
});

test('pausing freezes admission delays while in-flight results still reach the checkpoint', async () => {
  const h = harness();
  await h.advance(3000);
  await h.configure({ paused: true });
  await h.advance(100000);
  h.calls[0].finish(); await h.pump();
  assert.equal(h.pool.snapshot().state, 'paused');
  assert.equal(h.pool.snapshot().nextAttemptAt, null);
  assert.equal(h.pool.snapshot().checked, 1);
  await h.configure({ paused: false });
  await h.advance(2999);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  assert.equal(h.calls.length, 2);
  await h.stop(); h.calls[1].finish(); await h.pump();
});

test('a 429 from an in-flight ID outside the new range still cools down the entire pool', async () => {
  const h = harness();
  await h.advance(3000);
  await h.configure({ rangeStart: 2, rangeEnd: 3 });
  h.calls[0].reject(Object.assign(new Error('HTTP 429'), { retryable: true, globalCooldown: true, retryAfterMs: 20000 }));
  await h.pump();
  await h.configure({ concurrency: 4 });
  assert.equal(h.created.length, 2, 'new sessions must wait for the server cooldown');
  await h.advance(19999);
  assert.equal(h.calls.length, 1);
  await h.advance(1);
  assert.equal(h.calls[1].studentId, 'SE180002');
  await h.stop(); h.calls[1].finish(); await h.pump();
  assert.equal(h.pool.settled, true);
});

test('network retries leave other workers available and stop at the configured retry limit', async () => {
  const h = harness({ control: { maxRetries: 1, rangeEnd: 1 } });
  await h.advance(3000);
  h.calls[0].reject(Object.assign(new Error('ECONNRESET'), { retryable: true }));
  await h.pump();
  assert.equal(h.pool.snapshot().cooldownUntil, null);
  await h.advance(3000);
  assert.equal(h.calls[1].studentId, 'SE180001');
  h.calls[1].finish(); await h.pump();
  await h.advance(7000);
  assert.equal(h.calls[2].studentId, 'SE180000');
  assert.equal(h.calls[2].retryCount, 1);
  h.calls[2].reject(Object.assign(new Error('ECONNRESET again'), { retryable: true }));
  await h.pump();
  assert.equal(h.pool.failure.message, 'ECONNRESET again');
  await h.advance(100000);
  assert.equal(h.calls.length, 3);
  assert.equal(h.pool.settled, true);
});

test('Stop during form preparation closes sessions without submitting reserved IDs', async () => {
  const preparation = deferred();
  const h = harness({ prepare: () => preparation.promise });
  await h.advance(3000);
  assert.equal(h.pool.snapshot().workers.every(worker => worker.state === 'preparing'), true);
  await h.stop();
  preparation.resolve(); await h.pump();
  assert.equal(h.calls.length, 0);
  assert.equal(h.pool.settled, true);
  assert.equal(h.closed.length, 2);
});

test('Stop drains lookups and persistence, admits no new jobs, and closes every session', async () => {
  const disk = deferred();
  const h = harness({ persist: item => item.studentId === 'SE180000' ? disk.promise : Promise.resolve() });
  await h.advance(3000); await h.advance(3000);
  await h.stop();
  h.calls[0].finish(); h.calls[1].finish(); await h.pump();
  assert.equal(h.pool.settled, false);
  assert.equal(h.completed.size, 1);
  await h.advance(100000);
  assert.equal(h.calls.length, 2);
  disk.resolve(); await h.pump();
  assert.equal(h.pool.settled, true);
  assert.equal(h.completed.size, 2);
  assert.deepEqual(h.closed.sort(), [1, 2]);
});

test('reducing concurrency drains active workers, requeues reserved jobs and can scale up again', async () => {
  const h = harness();
  await h.advance(3000); await h.advance(3000);
  await h.configure({ concurrency: 1 });
  assert.equal(h.pool.snapshot().workers.find(worker => worker.id === 2).retiring, true);
  assert.deepEqual(h.closed, []);
  h.calls[1].finish(); await h.pump();
  assert.deepEqual(h.closed, [2]);
  await h.configure({ concurrency: 4 });
  assert.equal(h.pool.snapshot().workers.length, 4);
  // Worker 4 reserves an ID before its first send; retiring it must return that ID.
  await h.configure({ concurrency: 1 });
  h.calls[0].finish(); await h.pump();
  for (let i = 0; i < 4; i++) {
    await h.advance(3000);
    h.calls.at(-1).finish(); await h.pump();
  }
  assert.equal(h.pool.snapshot().checked, 6);
  assert.equal(new Set(h.saved).size, 6);
  await h.stop();
});

test('shrinking a range cancels reserved jobs, saves in-flight results and later expansion resumes unchecked IDs', async () => {
  const h = harness();
  await h.advance(3000);
  await h.configure({ rangeStart: 2, rangeEnd: 3 });
  assert.deepEqual(h.pool.snapshot().activeIds.sort(), ['SE180000', 'SE180002']);
  h.calls[0].finish(); await h.pump();
  assert.equal(h.completed.has('SE180000'), true);
  assert.equal(h.pool.snapshot().checked, 0);
  await h.advance(3000); h.calls[1].finish(); await h.pump();
  await h.advance(3000); h.calls[2].finish(); await h.pump();
  assert.equal(h.pool.snapshot().state, 'complete');
  await h.configure({ rangeStart: 0, rangeEnd: 3 });
  await h.advance(3000);
  assert.equal(h.calls[3].studentId, 'SE180001');
  h.calls[3].finish(); await h.pump();
  assert.equal(h.pool.snapshot().checked, 4);
  await h.stop();
});

test('an unexpected response stops all admissions while other in-flight results are saved', async () => {
  const h = harness();
  await h.advance(3000); await h.advance(3000);
  h.calls[0].reject(new Error('Unexpected CAPTCHA'));
  await h.pump();
  assert.equal(h.pool.failure.message, 'Unexpected CAPTCHA');
  assert.deepEqual(h.captured, [1]);
  await h.advance(100000);
  assert.equal(h.calls.length, 2);
  h.calls[1].finish(); await h.pump();
  assert.equal(h.pool.settled, true);
  assert.deepEqual(h.saved, ['SE180001']);
  assert.equal(h.pool.snapshot().error, 'Unexpected CAPTCHA');
});

test('a storage error stops the pool without retrying a successful upstream lookup', async () => {
  const h = harness({ persist: async () => { throw Object.assign(new Error('Disk failed'), { name: 'TimeoutError' }); } });
  await h.advance(3000);
  h.calls[0].finish(); await h.pump();
  assert.equal(h.pool.failure.message, 'Disk failed');
  assert.equal(h.completed.size, 0);
  await h.advance(100000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.pool.settled, true);
});

test('failed session initialization drains other sessions and stops cleanly', async () => {
  let closes = 0;
  const h = harness({ createWorker: async id => {
    if (id === 1) throw new Error('Browser disconnected');
    return { close: async () => { closes++; } };
  } });
  await h.pump();
  assert.equal(h.pool.failure.message, 'Browser disconnected');
  assert.equal(h.pool.settled, true);
  assert.equal(closes, 1);
});

test('single writer preserves concurrent results, valid snapshots and checkpoint resume', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-store-'));
  try {
    const store = await createCrawlStore(directory, 'https://fixture.example/');
    const items = Array.from({ length: 24 }, (_, i) => record(`SE18${String(i).padStart(4, '0')}`));
    items[1] = { studentId: items[1].studentId, status: 'not_found', fetchedAt: new Date().toISOString() };
    await Promise.all([...items, items[0]].map(item => store.save(item)));
    const lines = (await readFile(join(directory, 'crawl.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 24);
    assert.equal(new Set(lines.map(row => row.studentId)).size, 24);
    const snapshot = JSON.parse(await readFile(join(directory, 'official.json'), 'utf8'));
    assert.equal(snapshot.records.length, 23);
    assert.equal(snapshot.source, 'https://fixture.example/');
    const restored = await createCrawlStore(directory, snapshot.source);
    assert.equal(restored.completed.size, 24);
    assert.equal(restored.completed.get(items[1].studentId).status, 'not_found');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
