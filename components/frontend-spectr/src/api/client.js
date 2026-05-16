const BASE = '/api';

let _token = localStorage.getItem('spectr_token') ?? null;

export function setToken(t) {
  _token = t;
  if (t) localStorage.setItem('spectr_token', t);
  else {
    localStorage.removeItem('spectr_token');
    localStorage.removeItem('spectr_email');
  }
}

export function getToken() { return _token; }
export function getEmail() { return localStorage.getItem('spectr_email') ?? ''; }
function saveEmail(e) { if (e) localStorage.setItem('spectr_email', e); }

async function tryRefresh() {
  try {
    const res = await fetch(BASE + '/auth/refresh', { method: 'POST' });
    if (!res.ok) return false;
    const data = await res.json();
    setToken(data.access_token);
    return true;
  } catch {
    return false;
  }
}

async function request(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(BASE + path, { ...opts, headers });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retryHeaders = { ...(opts.headers ?? {}), 'Authorization': `Bearer ${_token}` };
      const retry = await fetch(BASE + path, { ...opts, headers: retryHeaders });
      if (retry.status === 401) {
        setToken(null);
        throw Object.assign(new Error('Unauthorized'), { status: 401 });
      }
      if (!retry.ok) {
        const body = await retry.text().catch(() => '');
        throw new Error(`HTTP ${retry.status}: ${body}`);
      }
      return retry.json();
    }
    setToken(null);
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

export async function login(email, password) {
  const data = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(async r => {
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.detail ?? `Login failed (${r.status})`);
    }
    return r.json();
  });
  setToken(data.access_token);
  saveEmail(email);
  return data;
}

export async function register(email, password) {
  const data = await fetch(BASE + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(async r => {
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.detail ?? `Registration failed (${r.status})`);
    }
    return r.json();
  });
  setToken(data.access_token);
  saveEmail(email);
  return data;
}

export async function changePassword(currentPassword, newPassword) {
  return request('/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export async function uploadTrack(file, refFile, alsFile, onProgress, genreHint, trackName, stems, referenceStems) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (refFile) form.append('reference', refFile);
    if (alsFile) form.append('als', alsFile);
    const name = (trackName || file.name.replace(/\.[^/.]+$/, '')).trim();
    if (name) form.append('track_name', name);
    if (genreHint) form.append('genre_hint', genreHint);
    (stems ?? []).forEach(s => form.append('stems', s));
    (referenceStems ?? []).forEach(s => form.append('reference_stems', s));

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) { setToken(null); reject(new Error('Unauthorized')); return; }
      if (xhr.status >= 400) {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : (body.detail.message ?? body.detail.code ?? msg);
        } catch {}
        reject(new Error(msg));
        return;
      }
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { reject(new Error('Invalid response')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.open('POST', BASE + '/uploads/');
    if (_token) xhr.setRequestHeader('Authorization', `Bearer ${_token}`);
    xhr.send(form);
  });
}

export async function confirmStemMapping(jobId, mappings) {
  return request(`/uploads/${jobId}/stems/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings }),
  });
}

export async function getJobStatus(jobId) {
  return request(`/jobs/${jobId}/status`);
}

export async function getJobs() {
  return request('/jobs');
}

export async function getJobResults(jobId) {
  return request(`/jobs/${jobId}/results`);
}

export async function getGenreProfiles() {
  return request('/genre-profiles');
}

export async function getGenreProfile(genre) {
  return request(`/genre-profiles/${genre}`);
}

export { request as apiRequest };

export const saveToLibrary = (jobId, body) =>
  request(`/jobs/${jobId}/save-to-library`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

export function streamJob(jobId, onPhase, onComplete, onError) {
  const url = `${BASE}/jobs/${jobId}/stream?token=${encodeURIComponent(_token ?? '')}`;
  const es = new EventSource(url);

  es.onmessage = e => {
    try { onPhase(JSON.parse(e.data)); } catch {}
  };
  es.addEventListener('complete', () => { es.close(); onComplete(); });
  es.addEventListener('error', () => { es.close(); onError(new Error('Stream error')); });

  return () => es.close();
}
