import { readFile } from 'node:fs/promises';
import { STUDENT_ID_REGEX } from '../src/lib/search.js';

export function normalizeOfficialRecords(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.records)) throw new Error('Invalid official snapshot');
  const unique = new Map();
  for (const value of snapshot.records) {
    if (!value || typeof value !== 'object') continue;
    const studentId = String(value.studentId ?? '').trim().toUpperCase();
    const name = String(value.name ?? '').trim().slice(0, 120);
    const shift = Number(value.shift);
    if (!STUDENT_ID_REGEX.test(studentId) || !name || ![1, 2, 3].includes(shift)) continue;
    const record = { studentId, name, shift, group: String(value.group ?? '').slice(0, 100) };
    for (const key of ['sessionLabel', 'fetchedAt']) {
      if (typeof value[key] === 'string') record[key] = value[key].slice(0, 120);
    }
    const previous = unique.get(studentId);
    if (!previous || (Date.parse(record.fetchedAt) || 0) >= (Date.parse(previous.fetchedAt) || 0)) unique.set(studentId, record);
  }
  if (snapshot.records.length && !unique.size) throw new Error('No valid official records');
  return [...unique.values()];
}

export async function loadOfficialRecords() {
  if (process.env.OFFICIAL_DATA_PATH) {
    return normalizeOfficialRecords(JSON.parse(await readFile(process.env.OFFICIAL_DATA_PATH, 'utf8')));
  }
  // Local crawl results take precedence; Git deployments use the exported snapshot.
  let contents;
  try { contents = await readFile(new URL('../.local-data/official.json', import.meta.url), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    contents = await readFile(new URL('../server-data/official.json', import.meta.url), 'utf8');
  }
  return normalizeOfficialRecords(JSON.parse(contents));
}
