import { apiRequest, getToken } from './client.js';

export const getVersion     = (id)             => apiRequest(`/versions/${id}`);
export const patchVersion   = (id, body)       => apiRequest(`/versions/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const deleteVersion  = (id)             => apiRequest(`/versions/${id}`, { method: 'DELETE' });
export const analyzeVersion = (id)             => apiRequest(`/versions/${id}/analyze`, { method: 'POST' });
export const confirmVersionStems = (id, body)  =>
  apiRequest(`/versions/${id}/stems/confirm`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

/** Multipart upload — XHR so we can attach upload progress. Bearer token from client.js. */
export async function createVersion(songId, { file, reference, als, stems, label, notes, onProgress } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  if (reference) fd.append('reference', reference);
  if (als) fd.append('als', als);
  if (label) fd.append('label', label);
  if (notes) fd.append('notes', notes);
  if (stems) for (const s of stems) fd.append('stems', s);

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Bad JSON in version response')); }
      } else {
        let msg = `${xhr.status}: ${xhr.responseText}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : (body.detail.message ?? body.detail.code ?? msg);
        } catch {}
        reject(Object.assign(new Error(msg), { status: xhr.status }));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', `/api/songs/${songId}/versions`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(fd);
  });
}
