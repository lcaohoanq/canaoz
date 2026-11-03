import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/search.js';

function makeResponse() {
  return {
    code: 200, headers: {}, body: null,
    setHeader(key, val) { this.headers[key] = val; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('API rejects invalid MSSV input and bad shift', async () => {
  let res = makeResponse();
  await handler({ method: 'GET', query: { q: 'AB12345' } }, res);
  assert.equal(res.code, 400);
  res = makeResponse();
  await handler({ method: 'GET', query: { q: 'Nguyen', shift: '4' } }, res);
  assert.equal(res.code, 400);
});

test('API does not return all users without query or shift', async () => {
  const res = makeResponse();
  await handler({ method: 'GET', query: {} }, res);
  assert.deepEqual(res.body, { ok: true, results: [] });
});

test('API returns setup error if no secret configured', async () => {
  const original = process.env.SHEETS_API_TOKEN;
  delete process.env.SHEETS_API_TOKEN;
  const res = makeResponse();
  await handler({ method: 'GET', query: { q: 'Nguyen' } }, res);
  assert.equal(res.code, 503);
  if (original !== undefined) process.env.SHEETS_API_TOKEN = original;
});
