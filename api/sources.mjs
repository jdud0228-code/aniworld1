import { get, put } from "@vercel/blob";

const SOURCES_PATH = "aniworld/sources-v1.json";
const MAX_SOURCES = 1000;
const ALLOWED_TYPES = new Set(["auto", "video", "embed"]);
const RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: RESPONSE_HEADERS });
}

function getConfig() {
  const blobToken = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  const adminToken = String(process.env.ANIWORLD_SOURCE_ADMIN_TOKEN || "");
  if (!blobToken && !adminToken) return { configured: false, writable: false };
  if (!blobToken) return { configured: true, writable: false, invalid: true };
  return { configured: true, writable: Boolean(adminToken), blobToken, adminToken };
}

function authorized(request, expectedToken) {
  const header = request.headers.get("authorization") || "";
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
  const result = await get(SOURCES_PATH, { access: "private" });
  if (!result || result.statusCode === 404) return Object.create(null);
  if (result.statusCode !== 200 || !result.stream) throw new Error("Blob read failed");
  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text);
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

async function handleWrite(request, config) {
  if (!config.writable) return jsonResponse({ error: "Source editing is not configured" }, 503);
  if (!authorized(request, config.adminToken)) return jsonResponse({ error: "Unauthorized" }, 401);
  let body;
  try { body = await request.json(); } catch (_) { return jsonResponse({ error: "Invalid JSON body" }, 400); }
  const key = body && body.key;
  if (!validKey(key)) return jsonResponse({ error: "Invalid source key" }, 400);

  try {
    const sources = await readSources();
    if (request.method === "POST") {
      const source = cleanSource(body);
      if (!source) return jsonResponse({ error: "Use a valid HTTPS source URL and source type" }, 400);
      if (!Object.prototype.hasOwnProperty.call(sources, key) && Object.keys(sources).length >= MAX_SOURCES) {
        return jsonResponse({ error: "Source library is full" }, 413);
      }
      sources[key] = source;
    } else {
      delete sources[key];
    }
    await writeSources(sources);
    return jsonResponse({ ok: true });
  } catch (_) {
    return jsonResponse({ error: "Shared source store is temporarily unavailable" }, 503);
  }
}

export default {
  async fetch(request) {
    const config = getConfig();
    if (request.method === "GET") {
      if (!config.configured) return jsonResponse({ configured: false, writable: false, sources: {} });
      if (config.invalid) return jsonResponse({ error: "Shared source store is not configured correctly" }, 503);
      try {
        const sources = await readSources();
        return jsonResponse({ configured: true, writable: config.writable, sources });
      } catch (_) {
        return jsonResponse({ error: "Shared source store is temporarily unavailable" }, 503);
      }
    }
    if (request.method !== "POST" && request.method !== "DELETE") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    if (!config.configured || config.invalid) return jsonResponse({ error: "Shared source store is not configured" }, 503);
    return handleWrite(request, config);
  }
};
