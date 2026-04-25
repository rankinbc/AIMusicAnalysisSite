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

async function request(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(BASE + path, { ...opts, headers });

  if (res.status === 401) {
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

export async function uploadTrack(file, refFile, alsFile, onProgress, genreHint) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (refFile) form.append('reference', refFile);
    if (alsFile) form.append('als', alsFile);
    form.append('track_name', file.name.replace(/\.[^/.]+$/, ''));
    if (genreHint) form.append('genre_hint', genreHint);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) { setToken(null); reject(new Error('Unauthorized')); return; }
      if (xhr.status >= 400) { reject(new Error(`Upload failed (${xhr.status})`)); return; }
      try { resolve(JSON.parse(xhr.responseText)); }
      catch { reject(new Error('Invalid response')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.open('POST', BASE + '/uploads/');
    if (_token) xhr.setRequestHeader('Authorization', `Bearer ${_token}`);
    xhr.send(form);
  });
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
