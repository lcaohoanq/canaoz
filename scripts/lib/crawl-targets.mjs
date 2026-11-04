import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import readExcelFile from 'read-excel-file/node';

const header = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const idHeaders = new Set(['mssv', 'masosinhvien', 'rollnumber', 'studentid', 'studentcode']);
export function normalizeStudentId(value) {
  const id = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}\d{6}$/.test(id) ? id : null;
}

// Read only the ID columns: names, emails, phone numbers and project codes are not targets.
export function extractSheetIds(rows) {
  let columns = [];
  const ids = [];
  let invalid = 0, recognized = false;
  for (const row of rows) {
    const headers = row.flatMap((cell, index) => idHeaders.has(header(cell)) ? [index] : []);
    if (headers.length) { columns = headers; recognized = true; continue; }
    for (const column of columns) {
      const cell = row[column];
      if (cell === null || cell === undefined || String(cell).trim() === '') continue;
      const id = normalizeStudentId(cell);
      if (id) ids.push(id);
      else invalid++;
    }
  }
  return { ids, invalid, recognized };
}

export function createTargetReader(directory = resolve('data'), readWorkbook = readExcelFile) {
  let cacheKey, cached;
  return async () => {
    const names = (await readdir(directory).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })).filter(name => /\.xlsx$/i.test(name) && !name.startsWith('~$')).sort();
    if (!names.length) { cacheKey = undefined; cached = null; return null; }
    const stamps = await Promise.all(names.map(async name => {
      const info = await stat(resolve(directory, name));
      return [name, info.size, info.mtimeMs, info.ctimeMs];
    }));
    const key = JSON.stringify(stamps);
    if (key === cacheKey) return cached;
    const unique = new Set(), files = [];
    let entries = 0, invalid = 0;
    for (const name of names) {
      const sheets = [];
      for (const { sheet, data } of await readWorkbook(resolve(directory, name))) {
        const result = extractSheetIds(data);
        entries += result.ids.length;
        invalid += result.invalid;
        result.ids.forEach(id => unique.add(id));
        sheets.push({ name: sheet, entries: result.ids.length, invalid: result.invalid, recognized: result.recognized });
      }
      if (!sheets.some(sheet => sheet.recognized)) throw new Error(`${name}: không tìm thấy cột MSSV / Rollnumber / Mã số sinh viên.`);
      files.push({ name, sheets });
    }
    if (!unique.size) throw new Error('Các file Excel không có MSSV hợp lệ.');
    cached = { ids: [...unique], summary: { type: 'sheets', total: unique.size, entries, duplicates: entries - unique.size, invalid, files } };
    cacheKey = key;
    return cached;
  };
}
