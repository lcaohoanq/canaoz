// Vercel Function. Never expose the Apps Script token to the browser.
const ID_RE = /^[A-Za-z]{2}[0-9]{6}$/;

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

  const apiUrl = process.env.SHEETS_API_URL;
  const token = process.env.SHEETS_API_TOKEN;
  if (!apiUrl || !token) {
    return res.status(503).json({ ok: false, message: 'Website chưa được kết nối với Google Sheets.' });
  }

  try {
    const parsedUrl = new URL(apiUrl);
    if (parsedUrl.hostname !== 'script.google.com' || !/\/exec$/.test(parsedUrl.pathname)) {
      throw new Error('Invalid service configuration');
    }
    const upstream = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, q, shift }),
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!upstream.ok) throw new Error(`Apps Script status ${upstream.status}`);
    const payload = await upstream.json();
    if (!payload || payload.ok !== true || !Array.isArray(payload.results)) {
      throw new Error('Invalid response from Apps Script');
    }
    const safeResults = payload.results.slice(0, 40).map((p) => ({
      name: String(p.name || '').slice(0, 120),
      shift: Number(p.shift),
      group: String(p.group || '').slice(0, 100),
      studentIdMasked: String(p.studentIdMasked || '********').slice(0, 8),
    })).filter((p) => p.name && [1, 2, 3].includes(p.shift));
    return res.status(200).json({ ok: true, results: safeResults });
  } catch (error) {
    console.error('Google Sheets search failed:', error?.message || 'unknown');
    return res.status(502).json({ ok: false, message: 'Không kết nối được dữ liệu. Bạn thử lại sau nha.' });
  }
}
