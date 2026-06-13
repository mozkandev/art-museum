// Vite plugin: injects /api/artist and /api/paintings into the dev server
// so we don't need a separate backend during development.
// Shared HTTP/cache logic lives in ./logic.js — the same module is used
// by the Vercel serverless functions in /api for production.

import "dotenv/config";
import { museumHandler } from "./logic-handler.js";

export function museumApi() {
  return {
    name: "museum-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const u = new URL(req.url, "http://localhost");
          if (u.pathname === "/api/artist" || u.pathname === "/api/paintings") {
            return await museumHandler(u, res);
          }
        } catch (e) {
          console.error("[api] middleware error:", e);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: String(e?.message || e) }));
          return;
        }
        return next();
      });
    },
  };
}
