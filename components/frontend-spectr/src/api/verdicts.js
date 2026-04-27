import { getToken } from './client.js';

const BASE = '/api';

/** Returns the cached verdicts payload, or null if not yet generated (404). */
export async function getVerdicts(jobId) {
  const res = await fetch(`${BASE}/reports/${jobId}/verdicts`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Opens an EventSource SSE stream and fires callbacks as events arrive.
 * Returns a cleanup function that closes the stream.
 *
 * Callbacks:
 *   onRoutingPlan(plan)   — triage decision, which specialists will run
 *   onVerdict(verdict)    — a single verdict (rule-engine or specialist)
 *   onComplete(payload)   — final deduped+ranked { verdicts } list
 *   onError(msg)          — connection error
 */
export function streamVerdicts(jobId, { onRoutingPlan, onVerdict, onComplete, onError } = {}) {
  const token = encodeURIComponent(getToken() ?? '');
  const url = `${BASE}/reports/${jobId}/verdicts/stream?token=${token}`;
  const es = new EventSource(url);

  es.addEventListener('routing-plan', e => {
    try { onRoutingPlan?.(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('rule-verdict', e => {
    try { onVerdict?.(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('verdict', e => {
    try { onVerdict?.(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('complete', e => {
    es.close();
    try { onComplete?.(JSON.parse(e.data)); } catch {}
  });
  // validation-failure and specialist-error are silently ignored
  es.onerror = () => {
    es.close();
    onError?.('Connection lost');
  };

  return () => es.close();
}

/** Optimistic dismiss — 204, no body. */
export async function dismissVerdict(verdictId) {
  await fetch(`${BASE}/verdicts/${verdictId}/dismiss`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
}

/** Record feedback — 204, no body. feedback: 'helpful' | 'wrong' | 'unclear' */
export async function giveFeedback(verdictId, feedback) {
  await fetch(`${BASE}/verdicts/${verdictId}/feedback`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ feedback }),
  });
}
