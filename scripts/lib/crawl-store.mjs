import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicJson } from './crawl-state.mjs';

export async function readCrawlCheckpoint(directory) {
  const checkpoint = resolve(directory, 'crawl.ndjson');
  const completed = new Map();
  const contents = await readFile(checkpoint, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  for (const line of contents.split('\n').filter(Boolean)) {
    const item = JSON.parse(line);
    completed.set(item.studentId, item);
  }
  return completed;
}

// One writer owns both files. A result is checkpointed before publishing its snapshot.
export async function createCrawlStore(directory, source) {
  const checkpoint = resolve(directory, 'crawl.ndjson');
  const completed = await readCrawlCheckpoint(directory);
  let queue = Promise.resolve();
  function serial(action) {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }
  async function snapshot() {
    const records = [...completed.values()].filter(row => row.status === 'found')
      .map(({ studentId, name, shift, sessionLabel, fetchedAt }) => ({ studentId, name, shift, group: '', sessionLabel, fetchedAt }));
    await atomicJson(resolve(directory, 'official.json'), { source, records });
  }
  return {
    completed,
    snapshot: () => serial(snapshot),
    save: item => serial(async () => {
      if (completed.has(item.studentId)) return;
      await appendFile(checkpoint, JSON.stringify(item) + '\n');
      completed.set(item.studentId, item);
      await snapshot();
    }),
  };
}
