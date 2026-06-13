// Vercel serverless: GET /api/artist?name=...
import "../server/logic.js";
import { museumHandler } from "../server/logic-handler.js";

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "x"}`);
  return museumHandler(url, res);
}
