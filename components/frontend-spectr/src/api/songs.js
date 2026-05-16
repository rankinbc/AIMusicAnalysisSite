import { apiRequest } from './client.js';

export const listSongs   = ()         => apiRequest('/songs/');
export const getSong     = (id)       => apiRequest(`/songs/${id}`);
export const createSong  = (body)     => apiRequest('/songs/', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const patchSong   = (id, body) => apiRequest(`/songs/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const deleteSong  = (id)       => apiRequest(`/songs/${id}`, { method: 'DELETE' });
export const restoreSong = (id)       => apiRequest(`/songs/${id}/restore`, { method: 'POST' });
