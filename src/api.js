// Tiny client wrappers around the Vite dev-server middleware.
// In production behind Vercel the same paths are served by the
// Vercel serverless function in /api (see README).

async function getJson(url) {
  const r = await fetch(url);
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  if (!r.ok) {
    const msg = (body && body.error) || `${r.status} ${r.statusText}`;
    throw new Error(`Request failed (${msg})`);
  }
  return body;
}

export function getArtist(name) {
  return getJson(`/api/artist?name=${encodeURIComponent(name)}`);
}

export function getPaintings(name) {
  return getJson(`/api/paintings?name=${encodeURIComponent(name)}`);
}
