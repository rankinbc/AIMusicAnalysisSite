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
 * Run a single specialist on-demand. Returns:
 *   { specialist, prompt_version, verdicts: [...], validation_failures: [...] }
 * Throws Error with .status for 401/404/410/5xx.
 */
export async function runSpecialist(jobId, slug) {
  const res = await fetch(`${BASE}/reports/${jobId}/verdicts/run/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (res.status === 404) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.detail || 'Not found'), { status: 404 });
  }
  if (res.status === 410) {
    throw Object.assign(new Error('Analysis not complete'), { status: 410 });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`HTTP ${res.status}: ${body}`), { status: res.status });
  }
  return res.json();
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
