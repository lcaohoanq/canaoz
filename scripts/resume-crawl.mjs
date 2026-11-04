import { createCrawlProcess } from '../server/crawl-process.js';
try {
  const worker = await createCrawlProcess().start();
  console.log(`${worker.alreadyRunning ? 'Crawler đang chạy' : 'Đã chạy tiếp crawler'} (PID ${worker.pid}). Theo dõi tại /crawl.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
