import { get, put } from "@vercel/blob";

const SOURCES_PATH = "aniworld/sources-v1.json";
const MAX_SOURCES = 1000;
const ALLOWED_TYPES = new Set(["auto", "video", "embed"]);

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(body);
}

function getConfig() {
  const blobToken = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  const adminToken = String(process.env.ANIWORLD_SOURCE_ADMIN_TOKEN || "");
  if (!blobToken && !adminToken) return { configured: false, writable: false };
  if (!blobToken) return { configured: true, writable: false, invalid: true };
  return { configured: true, writable: Boolean(adminToken), blobToken, adminToken };
}

function authorized(req, expectedToken) {
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\\s+([^\\s]+)$/i.exec(header);
  if (!match || !expectedToken) return false;
  const supplied = match[1];
  if (supplied.length !== expectedToken.length) return false;
  let difference = 0;
  for (let i = 0; i < supplied.length; i += 1) difference |= supplied.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  return difference === 0;
}

function cleanSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.url !== "string" || value.url.length > 2048) return null;
  const type = value.type || "auto";
  if (!ALLOWED_TYPES.has(type)) return null;
  try {
    const url = new URL(value.url);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return { url: url.href, type };
  } catch (_) {
    return null;
  }
}

function validKey(key) {
  return typeof key === "string" && key.length > 0 && key.length <= 300 &&
    key.trim() === key && key !== "__proto__" && key !== "constructor" &&
    key !== "prototype" && !/[\\u0000-\\u001f\\u007f]/.test(key);
}

async function readSources() {
  let result;
  try {
    result = await get(SOURCES_PATH, { access: "private" });
  } catch (error) {
    const message = String(error?.message || "");
    if (/not found|does not exist|404/i.test(message)) return Object.create(null);
    throw error;
  }
  if (!result || result.statusCode === 404) return Object.create(null);
  if (result.statusCode !== 200 || !result.stream) throw new Error("Blob read failed");
  const parsed = JSON.parse(await new Response(result.stream).text());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid source list");
  const keys = Object.keys(parsed);
  if (keys.length > MAX_SOURCES) throw new Error("Invalid source list");
  const sources = Object.create(null);
  for (const key of keys) {
    if (!validKey(key)) continue;
    const source = cleanSource(parsed[key]);
    if (source) sources[key] = source;
  }
  return sources;
}

async function writeSources(sources) {
  await put(SOURCES_PATH, JSON.stringify(sources), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0
  });
}

export default async function handler(req, res) {
  const config = getConfig();

  if (req.method === "GET") {
    if (!config.configured) return send(res, 200, { configured: false, writable: false, sources: {} });
    if (config.invalid) return send(res, 503, { error: "Shared source store is not configured correctly" });
    try {
      const sources = await readSources();
      return send(res, 200, { configured: true, writable: config.writable, sources });
    } catch (_) {
      return send(res, 503, { error: "Shared source store is temporarily unavailable" });
    }
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  }
  if (!config.configured || config.invalid) return send(res, 503, { error: "Shared source store is not configured" });
  if (!config.writable) return send(res, 503, { error: "Source editing is not configured" });
  if (!authorized(req, config.adminToken)) return send(res, 401, { error: "Unauthorized" });

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return send(res, 400, { error: "Invalid JSON body" });
  }
  const key = body.key;
  if (!validKey(key)) return send(res, 400, { error: "Invalid source key" });

  try {
    const sources = await readSources();
    if (req.method === "POST") {
      const source = cleanSource(body);
      if (!source) return send(res, 400, { error: "Use a valid HTTPS source URL and source type" });
      if (!Object.prototype.hasOwnProperty.call(sources, key) && Object.keys(sources).length >= MAX_SOURCES) {
        return send(res, 413, { error: "Source library is full" });
      }
      sources[key] = source;
    } else {
      delete sources[key];
    }
    await writeSources(sources);
    return send(res, 200, { ok: true });
  } catch (_) {
    return send(res, 503, { error: "Shared source store is temporarily unavailable" });
  }
}
