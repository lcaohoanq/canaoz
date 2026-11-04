import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import handler from '../api/search.js';

test('official API uses seed without Sheets secrets, masks IDs and handles missing data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-seed-'));
  const originalSource = process.env.SEARCH_SOURCE;
  const originalPath = process.env.OFFICIAL_DATA_PATH;
  const search = async (query) => {
    const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', query }, res);
    return res;
  };
  try {
    process.env.SEARCH_SOURCE = 'official';
    process.env.OFFICIAL_DATA_PATH = join(directory, 'seed.json');
    await writeFile(process.env.OFFICIAL_DATA_PATH, JSON.stringify({ records: [
      { studentId: 'AB123456', name: 'Nguyễn Minh An', shift: 2, group: '', sessionLabel: 'Phiên 2', fetchedAt: '2026-11-03' },
    ] }));
    const expected = [{ name: 'Nguyễn Minh An', shift: 2, group: '', studentIdMasked: 'AB****56' }];
    assert.deepEqual((await search({ q: 'ab123456' })).body.results, expected);
    assert.deepEqual((await search({ q: 'nguyen minh an', shift: '2' })).body.results, expected);
    assert.deepEqual((await search({ shift: '1' })).body.results, []);
    assert.deepEqual((await search({})).body.results, []);
    assert.equal((await search({ q: 'AB12345' })).code, 400);
    await rm(process.env.OFFICIAL_DATA_PATH);
    assert.equal((await search({ q: 'AB123456' })).code, 503);
  } finally {
    if (originalSource === undefined) delete process.env.SEARCH_SOURCE; else process.env.SEARCH_SOURCE = originalSource;
    if (originalPath === undefined) delete process.env.OFFICIAL_DATA_PATH; else process.env.OFFICIAL_DATA_PATH = originalPath;
    await rm(directory, { recursive: true, force: true });
  }
});
