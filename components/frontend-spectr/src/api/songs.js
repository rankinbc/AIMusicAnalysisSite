import { getToken } from './client.js';

const BASE = '/api';

async function req(path, opts = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const listSongs   = ()        => req('/songs/');
export const getSong     = (id)      => req(`/songs/${id}`);
export const reanalyzeSong = (id)    => req(`/songs/${id}/analyze`, { method: 'POST' });
