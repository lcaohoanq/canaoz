import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeOfficialRecords } from '../server/official-data.js';
import { atomicJson } from './lib/crawl-state.mjs';

export async function exportOfficial(input = resolve('.local-data/official.json'), output = resolve('server-data/official.json')) {
  const snapshot = JSON.parse(await readFile(input, 'utf8'));
  const records = normalizeOfficialRecords(snapshot).sort((a, b) => a.studentId.localeCompare(b.studentId));
  if (!records.length) throw new Error('Chưa có kết quả crawl để xuất.');
  await mkdir(dirname(output), { recursive: true });
  await atomicJson(output, { source: 'https://tracuu.srofptuhcm.com/', records });
  return { count: records.length, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await exportOfficial();
  console.log(`Đã xuất ${result.count} bản ghi vào ${result.output}.`);
}
