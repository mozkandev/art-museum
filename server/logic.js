// Shared logic for both the Vite dev-server middleware and the Vercel
// serverless functions in /api. Pure HTTP + caching — no framework deps.

import { neon } from "@neondatabase/serverless";

export const UA = "MuseeInteractive/0.1 (https://example.local/musee)";

export const PAINT_BLACKLIST_RE =
  /\b(signature|monogram|stamp|coin|map of|grave|gravestone|tomb|statue|bust|plaque|facade|façade|logo|x-?ray|infrared|press photo|publicity photo|photograph of|portrait photo|self[- ]portrait photo|reconstruction)\b/i;
export const ART_CATEGORY_RE =
  /(\/paint|\/art[ _-]?project|\/watercolou?r|\/drawing|\/canvas|\/works[ _-]?by|\/panel|\/fresco|\/tempera|\/self[- ]?portrait|\/oil[ _-]?on)/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polite HTTP w/ retry (429/503 → backoff, 4 attempts)
export async function fetchJson(url, attempt = 0) {
  const max = 4;
  for (let i = 0; i < max; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      if (r.status === 429 || r.status === 503) {
        if (i === max - 1) return { ok: false, status: r.status };
        await sleep(900 * (i + 1));
        continue;
      }
      if (!r.ok) return { ok: false, status: r.status };
      return { ok: true, data: await r.json() };
    } catch (e) {
      if (i === max - 1) return { ok: false, error: String(e) };
      await sleep(900 * (i + 1));
    }
  }
  return { ok: false };
}

export function cleanTitle(raw) {
  if (!raw) return "";
  // Strip any HTML tags first — Wikimedia ObjectName/Artist often contains
  // structured data markup like <div class="fn">…</div> or <i><b>…</b></i>.
  let s = String(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s*QS:[,;]\s*P\d+.*$/i, "")
    .replace(/\s*label:\s*.*$/i, "")
    .replace(/\s*-\s*Google Art Project.*$/i, "")
    .replace(/\s*-\s*WGA\s*\d+.*$/i, "")
    .replace(/\s*-\s*www\..*$/i, "")
    .replace(/\s*-\s*[A-Z][A-Z0-9_-]{3,}\.\w{2,4}\s*$/, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (s.length > 90) s = s.slice(0, 87).trimEnd() + "…";
  return s;
}

export function cleanDate(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s*QS:[,;]\s*P\d+.*$/i, "")
    .replace(/\s*-\s*Google Art Project.*$/i, "")
    .replace(/\s*-\s*WGA\s*\d+.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 60);
}

export function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bdetail\b|\bcrop\b|\b\d+\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────────────────
//  In-memory + optional Neon cache
// ────────────────────────────────────────────────────────────────────────────
const memCache = new Map();
let sql = null;
let sqlInitPromise = null;

function initSql() {
  if (sql !== null || sqlInitPromise) return;
  if (!process.env.DATABASE_URL) {
    console.warn("[api] DATABASE_URL not set — using in-memory cache only");
    sql = false; // sentinel: tried, not configured
    return;
  }
  sqlInitPromise = (async () => {
    try {
      sql = neon(process.env.DATABASE_URL);
      await sql`CREATE TABLE IF NOT EXISTS art_cache (key TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())`;
      console.log("[api] neon cache table ready");
    } catch (e) {
      console.warn("[api] neon init failed, in-memory only:", e?.message || e);
      sql = false;
    }
  })();
}

export async function cacheGet(key) {
  initSql();
  if (sqlInitPromise) await sqlInitPromise;
  const m = memCache.get(key);
  if (m) return m;
  if (!sql || sql === false) return null;
  try {
    const rows = await sql`SELECT data FROM art_cache WHERE key = ${key}`;
    if (rows && rows[0] && rows[0].data) {
      const data = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
      memCache.set(key, data);
      return data;
    }
  } catch (e) {
    console.warn("[api] cache get failed:", e?.message || e);
  }
  return null;
}

export async function cacheSet(key, data) {
  initSql();
  if (sqlInitPromise) await sqlInitPromise;
  memCache.set(key, data);
  if (!sql || sql === false) return;
  try {
    await sql`INSERT INTO art_cache (key, data, updated_at) VALUES (${key}, ${JSON.stringify(data)}, now())
              ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
  } catch (e) {
    console.warn("[api] cache set failed:", e?.message || e);
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Artist
// ────────────────────────────────────────────────────────────────────────────
export async function fetchArtist(name) {
  const key = `artist:${name}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const slug = encodeURIComponent(name.replace(/ /g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`;
  const r = await fetchJson(url);
  if (!r.ok || !r.data) {
    const fallback = {
      name,
      description: "",
      extract: "",
      thumbnail: null,
      pageUrl: `https://en.wikipedia.org/wiki/${slug}`,
    };
    await cacheSet(key, fallback);
    return fallback;
  }
  const d = r.data;
  const out = {
    name: d.title || name,
    description: d.description || "",
    extract: d.extract || "",
    thumbnail: d.thumbnail?.source || d.originalimage?.source || null,
    pageUrl: d.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${slug}`,
  };
  await cacheSet(key, out);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
//  Paintings
// ────────────────────────────────────────────────────────────────────────────
export async function gatherCandidates(name) {
  const wikiSlug = encodeURIComponent(name.replace(/ /g, "_"));
  const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/media-list/${wikiSlug}`;
  const w = await fetchJson(wikiUrl);
  const wikiFiles = [];
  if (w.ok && w.data?.items) {
    for (const item of w.data.items) {
      if (item.type === "image" && item.title) {
        const t = String(item.title);
        if (/\.(jpg|jpeg|png)$/i.test(t)) wikiFiles.push(t);
      }
    }
  }

  const catTitle = `Paintings by ${name}`;
  const catSlug = encodeURIComponent(catTitle.replace(/ /g, "_"));
  const catUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=${catSlug}&cmtype=file&cmlimit=200&origin=*`;
  const c = await fetchJson(catUrl);
  const catFiles = [];
  if (c.ok && c.data?.query?.categorymembers) {
    for (const m of c.data.query.categorymembers) catFiles.push(m.title);
  }

  let searchFiles = [];
  if (wikiFiles.length + catFiles.length < 8) {
    const s = await fetchJson(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&list=search&srnamespace=6&srsearch=${encodeURIComponent(
        `"${name}" painting oil on canvas`,
      )}&srlimit=80&origin=*`,
    );
    if (s.ok && s.data?.query?.search) {
      for (const m of s.data.query.search) searchFiles.push(m.title);
    }
  }

  const seen = new Set();
  const ordered = [];
  for (const t of [...wikiFiles, ...catFiles, ...searchFiles]) {
    if (!/\.(jpg|jpeg|png)$/i.test(t)) continue;
    if (PAINT_BLACKLIST_RE.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);
  }
  return ordered;
}

function parseCategories(html) {
  if (!html) return [];
  const out = [];
  const re = /title="Category:([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/_/g, " "));
  return out;
}

export async function batchImageInfo(titles) {
  const out = [];
  const batchSize = 20;
  for (let i = 0; i < titles.length; i += batchSize) {
    const batch = titles.slice(i, i + batchSize);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1400&titles=${batch
      .map(encodeURIComponent)
      .join("|")}&origin=*`;
    const r = await fetchJson(url);
    if (r.ok && r.data?.query?.pages) {
      for (const p of Object.values(r.data.query.pages)) {
        if (p.imageinfo && p.imageinfo[0]) {
          const ii = p.imageinfo[0];
          const em = ii.extmetadata || {};
          out.push({
            file: p.title,
            title: cleanTitle(
              em.ObjectName?.value ||
                p.title
                  .replace(/^File:/, "")
                  .replace(/\.[^.]+$/, "")
                  .replace(/_/g, " "),
            ),
            date: cleanDate(
              em.DateTimeOriginal?.value ||
                em.DateTime?.value ||
                em.CreationDate?.value ||
                "",
            ),
            artist: em.Artist?.value
              ? String(em.Artist.value).replace(/<[^>]+>/g, "").slice(0, 200)
              : "",
            url: ii.thumburl || ii.url,
            fullUrl: ii.url,
            width: ii.thumbwidth || ii.width || 0,
            height: ii.thumbheight || ii.height || 0,
            license: em.LicenseShortName?.value || "",
            categories: parseCategories(em.Categories?.value),
          });
        }
      }
    }
  }
  return out;
}

export async function fetchPaintings(name, max = 14) {
  const key = `paintings:${name}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  const candidates = await gatherCandidates(name);
  if (candidates.length === 0) {
    await cacheSet(key, []);
    return [];
  }

  const priority = new Map();
  candidates.forEach((t, i) => priority.set(t, i));

  const info = await batchImageInfo(candidates);
  info.sort((a, b) => (priority.get(a.file) ?? 0) - (priority.get(b.file) ?? 0));

  const sized = info.filter(
    (p) =>
      p.width > 0 &&
      p.height > 0 &&
      p.width >= 400 &&
      p.width / p.height >= 0.3 &&
      p.width / p.height <= 3.2,
  );

  const arts = sized.filter((p) =>
    p.categories && p.categories.some((c) => ART_CATEGORY_RE.test("/" + c)),
  );
  const pool = arts.length >= 4 ? arts : sized;

  const seenNorms = new Set();
  const final = [];
  for (const p of pool) {
    const k = normKey(p.title);
    if (!k) continue;
    if (seenNorms.has(k)) continue;
    seenNorms.add(k);
    final.push(p);
    if (final.length >= max) break;
  }

  await cacheSet(key, final);
  return final;
}
