import { getCalls } from './metrics';

// Timed bids (« Miser à 10 s de la fin »): the bid is sent so it lands just
// before the last 10 seconds — a bid inside them pushes the end back by a minute on both servers.
//
// offset: server clock − local clock, from the auction's `server_time` when the server gives one.
// x: sent at 10 s + x before the end, x = mean latency of the last API calls × LATENCY_FACTOR
//   (landing a little early is harmless, landing inside the window extends the auction).
// Timer: a Web Worker, because Chrome throttles main-thread timers in background tabs.

export const SNIPE_LEFT = 10_000;
export const LATENCY_FACTOR = 3;
/** Never less than this (ms): timers and the network jitter even when the server answers at once. */
export const MIN_MARGIN = 150;

export function latency(): number {
  const recent = getCalls()
    .filter((c) => !c.cached)
    .slice(-20)
    .map((c) => c.ms);
  return recent.length ? recent.reduce((s, ms) => s + ms, 0) / recent.length : 300;
}


const workerSrc = `
  const timers = new Map();
  onmessage = ({ data }) => {
    if (data.cancel != null) { clearTimeout(timers.get(data.cancel)); timers.delete(data.cancel); return; }
    const { id, at, request } = data;
    const fire = () => {
      const left = at - Date.now();
      if (left > 25) { timers.set(id, setTimeout(fire, left - 20)); return; }
      while (Date.now() < at) {}
      timers.delete(id);
      if (!request) return postMessage({ id });
      const sentAt = Date.now();
      fetch(request.url, request.init)
        .then(async (r) => postMessage({ id, sentAt, status: r.status, text: await r.text() }))
        .catch((e) => postMessage({ id, sentAt, status: 0, text: String(e) }));
    };
    fire();
  };
`;
let worker: Worker | null = null;
let seq = 0;
export type Fired = { sentAt?: number; status?: number; text?: string };
const callbacks = new Map<number, (r: Fired) => void>();

let noWorker = false;

/**
 * Runs `fn` at local epoch ms `at`, even in a background tab. Returns a cancel function. Falls
 * back to a page timer where a worker can't be created (a site's security policy may forbid them).
 */
export function runAt(at: number, fn: (r: Fired) => void, request?: { url: string; init: RequestInit }): () => void {
  if (!worker && !noWorker) {
    try {
      worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
      worker.onmessage = ({ data }) => {
        const cb = callbacks.get(data.id);
        callbacks.delete(data.id);
        cb?.(data);
      };
      worker.onerror = () => {
        // Refused after creation: move the pending timers to the page.
        noWorker = true;
        worker = null;
      };
    } catch {
      noWorker = true;
    }
  }
  if (!worker) {
    // Coarse page timer, then re-aim (background tabs may delay timers: aim early, then correct).
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const left = at - Date.now();
      if (left <= 5) return fn({});
      t = setTimeout(tick, left > 2000 ? left - 1000 : left);
    };
    tick();
    return () => clearTimeout(t);
  }
  const id = ++seq;
  callbacks.set(id, fn);
  worker.postMessage({ id, at, request });
  return () => {
    callbacks.delete(id);
    worker?.postMessage({ cancel: id });
  };
}
