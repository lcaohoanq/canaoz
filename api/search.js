// Vercel Function. Never expose the Apps Script token or complete IDs to the browser.
import { filterRecords } from '../src/lib/search.js';
import { loadOfficialRecords } from '../server/official-data.js';
const ID_RE = /^[A-Za-z]{2}[0-9]{6}$/;

async function searchSheets(q, shift, excludeStudentIds) {
  const apiUrl = process.env.SHEETS_API_URL;
  const token = process.env.SHEETS_API_TOKEN;
  if (!apiUrl || !token) throw new Error('Sheets is not configured');
  const parsedUrl = new URL(apiUrl);
  if (parsedUrl.hostname !== 'script.google.com' || parsedUrl.protocol !== 'https:' || !/\/exec$/.test(parsedUrl.pathname)) {
    throw new Error('Invalid service configuration');
  }
  const merging = Array.isArray(excludeStudentIds);
  const upstream = await fetch(parsedUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, q, shift, ...(merging ? { mergeVersion: 1, excludeStudentIds } : {}) }),
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!upstream.ok) throw new Error(`Apps Script status ${upstream.status}`);
  const payload = await upstream.json();
  if (!payload || payload.ok !== true || !Array.isArray(payload.results)) throw new Error('Invalid Apps Script response');
  // Older deployments ignore exclusions. Do not merge them and silently show duplicates.
  if (merging && payload.mergeVersion !== 1) throw new Error('Apps Script must be updated for hybrid search');
  return payload.results.slice(0, 40).filter(person => person && typeof person === 'object').map(person => ({
    name: String(person.name || '').trim().slice(0, 120),
    shift: Number(person.shift),
    group: String(person.group || '').slice(0, 100),
    studentIdMasked: String(person.studentIdMasked || '').toUpperCase(),
  })).filter(person => person.name && [1, 2, 3].includes(person.shift) && /^[A-Z]{2}\*{4}\d{2}$/.test(person.studentIdMasked));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });

  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 101) : '';
  const shift = typeof req.query.shift === 'string' ? req.query.shift : '';
  if (q.length > 100 || !/^$|^[123]$/.test(shift)) {
    return res.status(400).json({ ok: false, message: 'Tham số tìm kiếm không hợp lệ.' });
  }
  if (!q && !shift) return res.status(200).json({ ok: true, results: [] });
  if (q && /^[A-Za-z]+\d/.test(q) && !ID_RE.test(q)) {
    return res.status(400).json({ ok: false, message: 'MSSV cần gồm 2 chữ cái và 6 số.' });
  }
  if (q && !ID_RE.test(q) && [...q].length < 2) {
    return res.status(400).json({ ok: false, message: 'Nhập ít nhất 2 ký tự để tìm tên.' });
  }

  const source = process.env.SEARCH_SOURCE || 'sheets';
  if (source === 'official') {
    try { return res.status(200).json({ ok: true, results: filterRecords(await loadOfficialRecords(), q, shift) }); }
    catch { return res.status(503).json({ ok: false, message: 'Chưa có dữ liệu tra cứu từ nguồn trường. Hãy chạy crawler hoặc xuất snapshot trước.' }); }
  }

  if (source === 'hybrid') {
    let official, community;
    try { official = await loadOfficialRecords(); }
    catch { console.error('Official snapshot unavailable during hybrid search.'); }
    try {
      // Exclude ALL official IDs before Sheets filters or limits its results, even if
      // their official name/shift would not match this query. Mask collisions stay distinct.
      community = await searchSheets(q, shift, (official ?? []).map(person => person.studentId));
    } catch (error) { console.error('Community search unavailable:', error.message); }
    if (!official && !community) return res.status(503).json({ ok: false, message: 'Không tải được dữ liệu tra cứu. Bạn thử lại sau nha.' });
    const results = [
      ...filterRecords(official ?? [], q, shift).map(person => ({ ...person, source: 'official' })),
      ...(community ?? []).map(person => ({ ...person, source: 'community' })),
    ].slice(0, 40);
    const warning = official === undefined
      ? 'Hiện chỉ tải được đăng ký bổ sung. Dữ liệu từ trường tạm thời chưa hiển thị.'
      : community === undefined ? 'Hiện chỉ tải được dữ liệu từ trường. Các đăng ký bổ sung có thể chưa hiển thị.' : '';
    return res.status(200).json({ ok: true, results, ...(warning ? { warning } : {}) });
  }

  if (source !== 'sheets') return res.status(503).json({ ok: false, message: 'Nguồn dữ liệu chưa được cấu hình đúng.' });
  if (!process.env.SHEETS_API_URL || !process.env.SHEETS_API_TOKEN) {
    return res.status(503).json({ ok: false, message: 'Website chưa được kết nối với Google Sheets.' });
  }
  try { return res.status(200).json({ ok: true, results: await searchSheets(q, shift) }); }
  catch (error) {
    console.error('Google Sheets search failed:', error.message);
    return res.status(502).json({ ok: false, message: 'Không kết nối được dữ liệu. Bạn thử lại sau nha.' });
  }
}
