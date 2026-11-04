import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createTargetReader, extractSheetIds } from '../scripts/lib/crawl-targets.mjs';

test('finds ID columns after title rows and rejects malformed codes without extracting from emails or other columns', () => {
  assert.deepEqual(extractSheetIds([
    ['Title', 'SE189999'],
    [],
    ['Họ tên', ' Mã số sinh viên '],
    ['SE188888', ' se183518 '],
    ['Name', 'SE81519'],
    ['Name', 'SE183518@fpt.edu.vn'],
    ['Name', null],
    ['Name', ''],
    ['Rollnumber', 'Email'],
    ['ss170023', 'SE181234@fpt.edu.vn'],
    ['SP26SE049', 'SE181111'],
  ]), { ids: ['SE183518', 'SS170023'], invalid: 3, recognized: true });
});

test('deduplicates all workbooks and sheets, caches reads and reloads changed files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-targets-'));
  let calls = 0;
  const read = createTargetReader(directory, async path => {
    calls++;
    return basename(path) === 'one.xlsx' ? [
      { sheet: 'DS', data: [['Rollnumber'], ['SE183518'], ['ss170023'], ['SE63036']] },
      { sheet: 'DS 2', data: [['MSSV'], ['se183518'], ['DE180001']] },
    ] : [
      { sheet: 'Title only', data: [['Note', 'SE189999']] },
      { sheet: 'List', data: [['Mã số sinh viên'], ['SS170023'], ['HE180123']] },
    ];
  });
  try {
    assert.equal(await read(), null);
    await writeFile(join(directory, 'one.xlsx'), 'fixture');
    await writeFile(join(directory, 'two.xlsx'), 'fixture');
    await writeFile(join(directory, '~$locked.xlsx'), 'ignored');
    const targets = await read();
    assert.deepEqual(targets.ids, ['SE183518', 'SS170023', 'DE180001', 'HE180123']);
    assert.equal(targets.summary.entries, 6);
    assert.equal(targets.summary.duplicates, 2);
    assert.equal(targets.summary.invalid, 1);
    assert.equal(targets.summary.files.length, 2);
    assert.equal(calls, 2);
    assert.equal(await read(), targets);
    assert.equal(calls, 2);
    await writeFile(join(directory, 'one.xlsx'), 'fixture changed');
    assert.notEqual(await read(), targets);
    assert.equal(calls, 4);
    await rm(join(directory, 'two.xlsx'));
    assert.equal((await read()).summary.total, 3);
    await rm(join(directory, 'one.xlsx'));
    assert.equal(await read(), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('invalid or unreadable spreadsheets fail instead of generating IDs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-invalid-targets-'));
  try {
    await writeFile(join(directory, 'broken.xlsx'), 'invalid zip');
    await assert.rejects(createTargetReader(directory)());
    await assert.rejects(createTargetReader(directory, async () => [{ sheet: 'Notes', data: [['Title'], ['SE180001']] }])(), /không tìm thấy cột/);
    await assert.rejects(createTargetReader(directory, async () => [{ sheet: 'List', data: [['MSSV'], ['SE63036']] }])(), /không có MSSV hợp lệ/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
