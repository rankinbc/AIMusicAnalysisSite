import { getToken } from './client.js';

const BASE = '/api';

export async function getALSProject(jobId) {
  const res = await fetch(`${BASE}/reports/${jobId}/als-project`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
