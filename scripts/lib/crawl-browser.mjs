import { resolve } from 'node:path';

export async function createBrowserWorker(browser, { origin, directory }) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  let page;
  try {
    page = await context.newPage();
    async function loadForm() {
      await page.goto(origin, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForFunction(() => Object.keys(document.querySelector('input') ?? {}).some(k => k.startsWith('__reactProps')));
    }
    function transient(message, retryAfterMs = 0) {
      return Object.assign(new Error(message), { retryable: true, retryAfterMs });
    }
    async function prepare(studentId, retryCount = 0) {
      if (retryCount > 0) await loadForm();
      await page.locator('input[name="student-code"]').fill(studentId);
    }
    async function lookup(studentId) {
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url() === origin && r.request().method() === 'POST', { timeout: 30000 }),
        page.getByRole('button', { name: 'Tra cứu thông tin', exact: true }).click({ timeout: 10000 }),
      ]);
      if (response.status() === 429 || response.status() >= 500) {
        const retryAfter = response.headers()['retry-after'];
        const minimum = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0) : 0;
        throw Object.assign(transient(`Upstream HTTP ${response.status()}`, minimum), { globalCooldown: true });
      }
      if (!response.ok()) throw new Error(`Upstream HTTP ${response.status()}`);
      await response.finished();
      // Busy can clear before React's result animation finishes.
      await page.waitForFunction((expectedId) => {
        if (document.querySelector('button[type="submit"]')?.getAttribute('aria-busy') !== 'false') return false;
        const code = document.querySelector('p[class*="studentCode"]')?.textContent?.replace('Mã số sinh viên: ', '').trim();
        const found = code === expectedId && document.querySelector('h2[class*="studentName"]')?.textContent?.trim()
          && document.querySelector('strong[class*="studentSessionValue"]')?.textContent?.trim();
        return Boolean(found || document.body.innerText.includes('Chưa tìm thấy thông tin của bạn.') ||
          [...document.querySelectorAll('[role="alert"], [role="status"]')].some(el => el.textContent.trim()));
      }, studentId, { timeout: 30000 });
      const view = await page.evaluate(() => ({
        name: document.querySelector('h2[class*="studentName"]')?.textContent?.trim(),
        studentId: document.querySelector('p[class*="studentCode"]')?.textContent?.replace('Mã số sinh viên: ', '').trim(),
        sessionLabel: document.querySelector('strong[class*="studentSessionValue"]')?.textContent?.trim(),
        text: document.body.innerText,
      }));
      const fetchedAt = new Date().toISOString();
      if (view.name && view.studentId === studentId) {
        const match = view.sessionLabel?.match(/(?:phiên|ca)\s*0?([123])\b/iu);
        if (!match) throw new Error(`Unrecognized session for ${studentId}: ${view.sessionLabel}`);
        return { studentId, status: 'found', name: view.name, shift: Number(match[1]), sessionLabel: view.sessionLabel, fetchedAt };
      }
      if (view.text.includes('Chưa tìm thấy thông tin của bạn.')) return { studentId, status: 'not_found', fetchedAt };
      // Unknown responses and CAPTCHA require inspection, not automatic resubmission.
      throw new Error(`Unexpected response at ${studentId}; inspect stopped.png (possible CAPTCHA/rate limit/layout change).`);
    }

    await loadForm();
    return {
      prepare,
      lookup,
      capture: () => page.screenshot({ path: resolve(directory, 'stopped.png'), fullPage: true }),
      close: () => context.close(),
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
