import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import handler from '../api/search.js';

const official = [
  { studentId: ' ab123456 ', name: 'Nguyễn Minh An', shift: 2, group: '', fetchedAt: '2026-11-04' },
  { studentId: 'CD111222', name: 'Trần Bình', shift: 1, group: '' },
];
const headers = ['Timestamp', 'Họ và tên', 'MSSV', 'Ca tốt nghiệp', 'Lớp / nhóm', 'Đồng ý công khai'];
const formRow = (name, id, shift, consent = 'Tôi đồng ý') => ['today', name, id, `Ca ${shift}`, '', consent];
const community = [
  formRow('Tên khai sai', 'AB123456', 3),
  formRow('Trần Bình', 'CD111222', 2),
  formRow('Lê Minh', 'EF333444', 2),
  formRow('Lê Minh', 'ef333444', 3),
  formRow('Bạn bổ sung', 'AB999956', 2),
  formRow('Không đồng ý', 'GH555666', 2, 'Tôi không đồng ý'),
];

async function fixture(run, { records = official, rows = community } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-hybrid-'));
  const keys = ['SEARCH_SOURCE', 'OFFICIAL_DATA_PATH', 'SHEETS_API_URL', 'SHEETS_API_TOKEN'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requests = [];
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'TEST_TOKEN' }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getDisplayValues: () => [headers, ...rows] }) }) }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: content => ({ content, setMimeType() { return this; } }) },
    console,
  };
  vm.runInNewContext(readFileSync('apps-script/Code.gs', 'utf8'), ctx);
  const search = async query => {
    const res = { code: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', query }, res);
    return res;
  };
  try {
    Object.assign(process.env, { SEARCH_SOURCE: 'hybrid', OFFICIAL_DATA_PATH: join(directory, 'official.json'), SHEETS_API_URL: 'https://script.google.com/macros/s/test/exec', SHEETS_API_TOKEN: 'TEST_TOKEN' });
    await writeFile(process.env.OFFICIAL_DATA_PATH, JSON.stringify({ records }));
    globalThis.fetch = async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => JSON.parse(ctx.doPost({ postData: { contents: options.body } }).content) };
    };
    await run({ search, requests, directory });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
    await rm(directory, { recursive: true, force: true });
  }
}

test('hybrid merges real Apps Script output, prioritizes official IDs globally and preserves masked collisions', async () => {
  await fixture(async ({ search, requests }) => {
    const res = await search({ shift: '2' });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.results.map(person => [person.name, person.studentIdMasked, person.source]), [
      ['Nguyễn Minh An', 'AB****56', 'official'],
      ['Bạn bổ sung', 'AB****56', 'community'],
    ]);
    assert.equal(res.body.warning, undefined);
    assert.deepEqual(requests[0].body.excludeStudentIds, ['AB123456', 'CD111222']);
    const serialized = JSON.stringify(res.body);
    for (const secret of ['TEST_TOKEN', 'AB123456', 'AB999956', 'CD111222', 'excludeStudentIds']) assert.equal(serialized.includes(secret), false);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual((await search({ q: 'ten khai sai' })).body.results, []);
    assert.deepEqual((await search({ q: 'ab123456', shift: '3' })).body.results, []);
    assert.equal((await search({ q: 'nguyen minh an' })).body.results[0].source, 'official');
    assert.deepEqual((await search({ shift: '3' })).body.results.map(person => person.name), ['Lê Minh']);
    assert.deepEqual((await search({ q: 'GH555666' })).body.results, []);
  });
});

test('exclusions are applied before the Sheets limit so duplicate official IDs cannot hide new submissions', async () => {
  const records = Array.from({ length: 45 }, (_, i) => ({ studentId: `SE18${String(i).padStart(4, '0')}`, name: `Official ${i}`, shift: 1 }));
  const rows = records.map(person => formRow(person.name, person.studentId, 2));
  rows.push(formRow('Bổ sung sau 45 mã trùng', 'ZZ123456', 2));
  await fixture(async ({ search }) => {
    const result = await search({ shift: '2' });
    assert.deepEqual(result.body.results.map(person => person.name), ['Bổ sung sau 45 mã trùng']);
  }, { records, rows });
});

test('combined results have one limit of 40 and do not dump either source without a query or shift', async () => {
  const records = Array.from({ length: 39 }, (_, i) => ({ studentId: `SE18${String(i).padStart(4, '0')}`, name: `Official ${i}`, shift: 2 }));
  await fixture(async ({ search, requests }) => {
    const res = await search({ shift: '2' });
    assert.equal(res.body.results.length, 40);
    assert.equal(res.body.results.filter(person => person.source === 'community').length, 1);
    assert.deepEqual((await search({})).body, { ok: true, results: [] });
    assert.equal(requests.length, 1);
    assert.equal((await search({ q: 'AB12345' })).code, 400);
    assert.equal(requests.length, 1);
  }, { records, rows: [formRow('One', 'ZZ123456', 2), formRow('Two', 'ZZ123457', 2)] });
});

test('hybrid serves official results with a visible warning when Sheets fails or uses the old protocol', async () => {
  await fixture(async ({ search }) => {
    for (const fetch of [
      async () => { throw new Error('Timeout'); },
      async () => ({ ok: false, status: 503 }),
      async () => ({ ok: true, json: async () => ({ ok: true, results: [{ name: 'Duplicate', studentIdMasked: 'AB****56', shift: 3 }] }) }),
      async () => ({ ok: true, json: async () => ({ ok: false, error: 'unauthorized' }) }),
    ]) {
      globalThis.fetch = fetch;
      const res = await search({ q: 'AB123456' });
      assert.equal(res.code, 200);
      assert.equal(res.body.results.length, 1);
      assert.equal(res.body.results[0].source, 'official');
      assert.match(res.body.warning, /đăng ký bổ sung/);
    }
  });
});

test('missing or malformed official data falls back to consenting Sheets rows; both sources failing returns 503', async () => {
  await fixture(async ({ search, requests }) => {
    for (const contents of ['invalid json', JSON.stringify({ wrong: [] })]) {
      await writeFile(process.env.OFFICIAL_DATA_PATH, contents);
      const res = await search({ shift: '2' });
      assert.equal(res.code, 200);
      assert.equal(res.body.results.every(person => person.source === 'community'), true);
      assert.match(res.body.warning, /Dữ liệu từ trường/);
      assert.deepEqual(requests.at(-1).body.excludeStudentIds, []);
    }
    await rm(process.env.OFFICIAL_DATA_PATH);
    assert.equal((await search({ shift: '2' })).code, 200);
    globalThis.fetch = async () => { throw new Error('Offline'); };
    assert.equal((await search({ shift: '2' })).code, 503);
  });
});

test('Sheets-only remains supported and the API strips internal fields and unmasked or malformed IDs', async () => {
  await fixture(async ({ search }) => {
    process.env.SEARCH_SOURCE = 'sheets';
    const res = await search({ q: 'AB123456' });
    assert.equal(res.code, 200);
    assert.equal(res.body.results[0].name, 'Tên khai sai');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, results: [
      { name: 'Allowed', studentIdMasked: 'AB****56', studentId: 'AB123456', shift: '2', token: 'SECRET', email: 'secret@example.test' },
      { name: 'Unmasked', studentIdMasked: 'CD111222', shift: 2 },
      { name: 'Invalid', studentIdMasked: '********', shift: 2 }, null,
    ] }) });
    assert.deepEqual((await search({ shift: '2' })).body.results, [{ name: 'Allowed', studentIdMasked: 'AB****56', shift: 2, group: '' }]);
  });
});
