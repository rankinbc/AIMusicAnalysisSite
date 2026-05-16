import { apiRequest } from './client.js';

export const listSongs   = ()         => apiRequest('/songs/');
export const getSong     = (id)       => apiRequest(`/songs/${id}`);
export const createSong  = (body)     => apiRequest('/songs/', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const patchSong   = (id, body) => apiRequest(`/songs/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const deleteSong  = (id)       => apiRequest(`/songs/${id}`, { method: 'DELETE' });
export const restoreSong = (id)       => apiRequest(`/songs/${id}/restore`, { method: 'POST' });
// Stub kept for SongLibrary.jsx import-time compatibility until that component
// is removed (Plan Task 22). Songs no longer own files; use analyzeVersion via
// api/versions.js once the LibraryPage/SongDetailPage land.
export const reanalyzeSong = (_id) => Promise.reject(new Error('reanalyzeSong removed — use analyzeVersion'));
