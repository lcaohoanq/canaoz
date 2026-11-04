import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const defaults = { concurrency: 2, delayMs: 10000, retryDelayMs: 60000, maxRetries: 3, autoBackoff: true, paused: false, rangeStart: 0, rangeEnd: 99, prefixes: ['SE18', 'SS18', 'SE17', 'SS17'] };
export function validateControl(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(defaults, k))) throw new Error('Cấu hình không hợp lệ.');
  const result = { ...defaults, ...value };
  for (const [key, min, max] of [['concurrency', 1, 4], ['delayMs', 3000, 600000], ['retryDelayMs', 10000, 3600000], ['maxRetries', 0, 10]]) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`${key}: cần số nguyên từ ${min} đến ${max}.`);
  }
  if (typeof result.paused !== 'boolean' || typeof result.autoBackoff !== 'boolean') throw new Error('Giá trị bật/tắt không hợp lệ.');
  if (!Number.isInteger(result.rangeStart) || !Number.isInteger(result.rangeEnd) || result.rangeStart < 0 || result.rangeEnd > 9999 || result.rangeStart > result.rangeEnd) throw new Error('Khoảng mã cần từ 0000 đến 9999, số bắt đầu không lớn hơn số kết thúc.');
  if (!Array.isArray(result.prefixes) || !result.prefixes.length || new Set(result.prefixes).size !== result.prefixes.length || result.prefixes.some(prefix => !defaults.prefixes.includes(prefix))) throw new Error('Chọn ít nhất một nhóm hợp lệ, không trùng nhau.');
  return result;
}
export function planIds(control) {
  return control.prefixes.flatMap(prefix => Array.from({ length: control.rangeEnd - control.rangeStart + 1 }, (_, index) => prefix + String(control.rangeStart + index).padStart(4, '0')));
}
export async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function atomicJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, path);
}
export async function readControl(directory) {
  return validateControl(await readJson(resolve(directory, 'control.json'), {}));
}
export async function writeControl(directory, value) {
  const result = validateControl(value);
  await mkdir(directory, { recursive: true });
  await atomicJson(resolve(directory, 'control.json'), result);
  return result;
}
export function retryWait(config, attempt, retryAfterMs = 0) {
  return Math.max(retryAfterMs, Math.min(3600000, config.retryDelayMs * (config.autoBackoff ? 2 ** (attempt - 1) : 1)));
}
