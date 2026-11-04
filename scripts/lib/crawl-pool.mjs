import { planIds, retryWait } from './crawl-state.mjs';
import { normalizeStudentId } from './crawl-targets.mjs';

// The coordinator alone claims IDs and admits requests. Browser sessions only look up IDs.
export function createCrawlPool({ control: initialControl, completed, createWorker, persist, targetIds = null, onEvent = () => {}, now = Date.now }) {
  let control = initialControl;
  let plannedIds = [], planned = new Set(), pending = [], cursor = 0, planKey = '';
  const claimed = new Set(), workers = new Map();
  let stopping = false, fatal = null, error = null, lastError = null;
  let pausedAt = control.paused ? now() : null, pausedMs = 0;
  const clock = () => now() - pausedMs - (pausedAt === null ? 0 : now() - pausedAt);
  let lastStart = clock(), cooldownUntil = 0;
  const nextSlot = () => Math.max(lastStart + control.delayMs, cooldownUntil);
  const timestamp = deadline => new Date(now() + Math.max(0, deadline - clock())).toISOString();
  function fail(failure, worker) {
    if (fatal) return;
    fatal = failure;
    error = failure.message;
    lastError = { at: new Date(now()).toISOString(), studentId: worker?.studentId ?? null, workerId: worker?.id ?? null, message: error };
    onEvent(`Stopped: ${error}`);
  }
  function release(worker, requeue = false) {
    const id = worker.studentId;
    claimed.delete(id);
    if (requeue && planned.has(id) && !completed.has(id)) pending.push(id);
    worker.studentId = null;
    worker.retryCount = 0;
    worker.retryAt = null;
  }
  function apply(next) {
    if (next.paused && pausedAt === null) pausedAt = now();
    if (!next.paused && pausedAt !== null) { pausedMs += now() - pausedAt; pausedAt = null; }
    control = next;
    const key = JSON.stringify(targetIds ?? [next.rangeStart, next.rangeEnd, next.prefixes]);
    if (key !== planKey) {
      plannedIds = targetIds === null ? planIds(control) : [...new Set(targetIds.map(normalizeStudentId).filter(Boolean))];
      planned = new Set(plannedIds);
      pending = plannedIds.filter(id => !completed.has(id) && !claimed.has(id));
      cursor = 0;
      planKey = key;
    }
  }
  function prepare(id) {
    const worker = { id, state: 'starting', studentId: null, retryCount: 0, retryAt: null, error: null, session: null, task: null };
    workers.set(id, worker);
    worker.task = Promise.resolve().then(() => createWorker(id)).then(session => {
      worker.session = session;
      worker.state = 'idle';
    }).catch(failure => { worker.state = 'idle'; fail(failure, worker); }).finally(() => { worker.task = null; });
  }
  function retire(worker) {
    release(worker, true);
    worker.state = 'closing';
    worker.task = Promise.resolve().then(() => worker.session?.close()).catch(failure => fail(failure, worker))
      .finally(() => { workers.delete(worker.id); });
  }
  function take() {
    while (cursor < pending.length) {
      const id = pending[cursor++];
      if (!completed.has(id) && !claimed.has(id) && planned.has(id)) return id;
    }
    return null;
  }
  async function handleFailure(failure, worker) {
    if (!fatal) {
      worker.error = failure.message;
      error = failure.message;
      lastError = { at: new Date(now()).toISOString(), studentId: worker.studentId, workerId: worker.id, message: error };
    }
    const retryable = failure.retryable || failure.name === 'TimeoutError' || /NS_ERROR_|net::ERR_|ECONNRESET/.test(failure.message);
    const retryAt = clock() + retryWait(control, worker.retryCount + 1, failure.retryAfterMs || 0);
    // A server cooldown still applies if this job was removed from the current range.
    if (failure.globalCooldown && !stopping && !fatal) cooldownUntil = Math.max(cooldownUntil, retryAt);
    if (stopping || fatal || !planned.has(worker.studentId)) {
      release(worker); worker.state = 'idle'; return;
    }
    if (!retryable || worker.retryCount >= control.maxRetries) {
      fail(failure, worker);
      await worker.session.capture?.().catch(() => {});
      release(worker); worker.state = 'idle'; return;
    }
    worker.retryCount++;
    worker.retryAt = retryAt;
    worker.state = 'retrying';
    onEvent(`Worker ${worker.id} · ${worker.studentId}: retry ${worker.retryCount}/${control.maxRetries}: ${error}`);
  }
  function prepareLookup(worker) {
    worker.state = 'preparing';
    worker.task = Promise.resolve().then(() => worker.session.prepare?.(worker.studentId, worker.retryCount))
      .then(() => { worker.state = 'ready'; })
      .catch(failure => handleFailure(failure, worker))
      .finally(() => { worker.task = null; });
  }
  function run(worker) {
    worker.state = 'running';
    worker.error = null;
    lastStart = clock();
    worker.task = (async () => {
      let item;
      try {
        item = await worker.session.lookup(worker.studentId, worker.retryCount);
      } catch (failure) {
        await handleFailure(failure, worker);
        return;
      }
      // A disk failure must stop the pool, never trigger another upstream lookup.
      try {
        if (item.studentId !== worker.studentId) throw new Error('Worker returned a different student ID.');
        await persist(item);
        completed.set(item.studentId, item);
        if (!fatal) error = null;
        onEvent(`Worker ${worker.id} · ${item.studentId}: ${item.status}`);
      } catch (failure) { fail(failure, worker); }
      release(worker);
      worker.state = 'idle';
    })().catch(failure => { fail(failure, worker); release(worker); worker.state = 'idle'; })
      .finally(() => { worker.task = null; });
  }
  apply(control);
  return {
    setTargets(ids) { targetIds = ids; apply(control); },
    tick(next = control, stopRequested = false) {
      apply(next);
      stopping ||= stopRequested;
      for (const worker of workers.values()) {
        if (worker.task) continue;
        if (stopping || fatal || worker.id > control.concurrency) { retire(worker); continue; }
        if (worker.studentId && !planned.has(worker.studentId)) { release(worker); worker.state = 'idle'; }
      }
      if (stopping || fatal) return;
      if (control.paused || clock() < cooldownUntil) return;
      for (let id = 1; id <= control.concurrency; id++) if (!workers.has(id)) prepare(id);
      const available = [...workers.values()].filter(worker => !worker.task && worker.id <= control.concurrency);
      for (const worker of available) {
        if (worker.state === 'idle') {
          worker.studentId = take();
          if (!worker.studentId) continue;
          claimed.add(worker.studentId);
          prepareLookup(worker);
        } else if (worker.state === 'retrying' && clock() >= worker.retryAt) prepareLookup(worker);
      }
      if (clock() < nextSlot()) return;
      const worker = available.find(worker => worker.state === 'ready' && worker.retryCount > 0)
        ?? available.find(worker => worker.state === 'ready');
      if (worker) run(worker);
    },
    stop(failure) { stopping = true; if (failure) fail(failure); },
    get settled() { return (stopping || fatal !== null) && workers.size === 0; },
    get failure() { return fatal; },
    snapshot() {
      const rows = plannedIds.map(id => completed.get(id)).filter(Boolean);
      const slots = [...workers.values()];
      const running = slots.some(worker => worker.state === 'running');
      const retrying = slots.some(worker => worker.state === 'retrying');
      const hasPending = claimed.size > 0 || pending.slice(cursor).some(id => !completed.has(id) && !claimed.has(id));
      const stopped = stopping || fatal;
      const state = stopped ? (workers.size ? 'stopping' : 'stopped') : control.paused ? 'paused' : running ? 'running'
        : !hasPending ? 'complete' : slots.some(worker => worker.state === 'starting') ? 'starting' : retrying ? 'retrying' : 'waiting';
      const deadlines = slots.filter(worker => !worker.task && worker.studentId && worker.id <= control.concurrency)
        .map(worker => worker.state === 'retrying' ? Math.max(nextSlot(), worker.retryAt) : nextSlot());
      const activeIds = slots.map(worker => worker.studentId).filter(Boolean);
      return {
        state, planned: plannedIds.length, checked: rows.length, found: rows.filter(row => row.status === 'found').length,
        updatedAt: rows.reduce((latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest, null),
        error, lastError, activeId: activeIds[0] ?? null, activeIds,
        retryCount: Math.max(0, ...slots.map(worker => worker.retryCount)),
        nextAttemptAt: !stopped && !control.paused && hasPending && deadlines.length ? timestamp(Math.min(...deadlines)) : null,
        cooldownUntil: !stopped && !control.paused && cooldownUntil > clock() ? timestamp(cooldownUntil) : null,
        workers: slots.map(worker => ({ id: worker.id, state: worker.state, studentId: worker.studentId, retryCount: worker.retryCount,
          error: worker.error, retiring: worker.id > control.concurrency,
          nextAttemptAt: !stopped && !control.paused && worker.state === 'retrying' ? timestamp(Math.max(nextSlot(), worker.retryAt)) : null })),
        groups: [...new Set(plannedIds.map(id => id.slice(0, 4)))].sort().map(prefix => ({ prefix, planned: plannedIds.filter(id => id.startsWith(prefix)).length,
          checked: rows.filter(row => row.studentId.startsWith(prefix)).length,
          found: rows.filter(row => row.studentId.startsWith(prefix) && row.status === 'found').length })),
      };
    },
  };
}
