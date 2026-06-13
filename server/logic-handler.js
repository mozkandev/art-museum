// Common HTTP handler for both the Vite dev-server middleware
// (server/api.js) and the Vercel serverless functions in /api.
// Just reads ?name= from the URL and delegates to the shared logic.

import { fetchArtist, fetchPaintings } from "./logic.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function museumHandler(url, res) {
  const name = url.searchParams.get("name");
  if (!name) {
    return sendJson(res, 400, { error: "missing name" });
  }
  try {
    if (url.pathname === "/api/artist") {
      const data = await fetchArtist(name);
      return sendJson(res, 200, data);
    }
    if (url.pathname === "/api/paintings") {
      const data = await fetchPaintings(name);
      return sendJson(res, 200, data);
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    console.error("[api] handler error:", e);
    return sendJson(res, 500, { error: String(e?.message || e) });
  }
}
