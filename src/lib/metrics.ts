// The client's recent network calls (their latency aims timed bids).
export type CallLog = { url: string; ms: number; bytes: number; at: number; cached: boolean };

const log: CallLog[] = [];

export function recordCall(entry: CallLog) {
  log.push(entry);
  if (log.length > 200) log.splice(0, log.length - 200);
}

export function getCalls() {
  return log;
}

