import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportOfficial } from '../scripts/export-official.mjs';

test('repo export keeps the latest canonical ID, strips extra fields, produces stable output and protects an existing snapshot on error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canaoz-export-'));
  const input = join(directory, 'local.json'), output = join(directory, 'repo', 'official.json');
  try {
    await writeFile(input, JSON.stringify({ token: 'SECRET', records: [
      { studentId: 'ab123456', name: 'Older', shift: 1, fetchedAt: '2026-11-01', email: 'private@example.test' },
      { studentId: ' AB123456 ', name: 'Newer', shift: '2', fetchedAt: '2026-11-04', phone: 'private', sessionLabel: 'Ca 2' },
      { studentId: 'CD111222', name: 'Second', shift: 3, group: 'IT', seat: 'private' },
      { studentId: 'bad', name: 'Invalid', shift: 1 }, null,
    ] }));
    assert.equal((await exportOfficial(input, output)).count, 2);
    const contents = await readFile(output, 'utf8');
    const snapshot = JSON.parse(contents);
    assert.deepEqual(snapshot.records, [
      { studentId: 'AB123456', name: 'Newer', shift: 2, group: '', sessionLabel: 'Ca 2', fetchedAt: '2026-11-04' },
      { studentId: 'CD111222', name: 'Second', shift: 3, group: 'IT' },
    ]);
    assert.equal(contents.includes('private'), false);
    assert.equal(contents.includes('SECRET'), false);
    await exportOfficial(input, output);
    assert.equal(await readFile(output, 'utf8'), contents);
    for (const value of [{ records: [] }, { records: [{ studentId: 'invalid' }] }, {}]) {
      await writeFile(input, JSON.stringify(value));
      await assert.rejects(exportOfficial(input, output));
      assert.equal(await readFile(output, 'utf8'), contents);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
