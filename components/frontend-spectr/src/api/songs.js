import { apiRequest } from './client.js';

export const listSongs    = ()     => apiRequest('/songs/');
export const getSong      = (id)   => apiRequest(`/songs/${id}`);
export const reanalyzeSong = (id)  => apiRequest(`/songs/${id}/analyze`, { method: 'POST' });
