const SOURCES_HASH = "aniworld:sources:v1";
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
  const restUrl = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const restToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const adminToken = String(process.env.ANIWORLD_SOURCE_ADMIN_TOKEN || "");
  if (!restUrl && !restToken && !adminToken) {
    return { configured: false, writable: false };
  }
  if (!restUrl || !restToken) return { configured: true, writable: false, invalid: true };

  try {
    const parsed = new URL(restUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return { configured: true, writable: false, invalid: true };
    }
    return {
      configured: true,
      writable: Boolean(adminToken),
      restUrl: parsed.href.replace(/\/+$/, ""),
      restToken,
      adminToken
    };
  } catch (_) {
    return { configured: true, writable: false, invalid: true };
  }
}

function authorized(request, expectedToken) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match || !expectedToken) return false;
  const supplied = match[1];
  if (supplied.length !== expectedToken.length) return false;
  let difference = 0;
  for (let i = 0; i < supplied.length; i += 1) {
    difference |= supplied.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  }
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
    return { url: url.href, type: type };
  } catch (_) {
    return null;
  }
}

function validKey(key) {
  return typeof key === "string" &&
    key.length > 0 &&
    key.length <= 300 &&
    key.trim() === key &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype" &&
    !/[\u0000-\u001f\u007f]/.test(key);
}

async function redisCommand(config, command) {
  const result = await fetch(config.restUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer " + config.restToken,
      "content-type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok || !payload || Object.prototype.hasOwnProperty.call(payload, "error")) {
    throw new Error("Redis command failed");
  }
  return payload.result;
}

async function readSources(config) {
  const values = await redisCommand(config, ["HGETALL", SOURCES_HASH]);
  if (!Array.isArray(values) || values.length % 2 !== 0 || values.length / 2 > MAX_SOURCES) {
    throw new Error("Invalid source list");
  }

  const sources = Object.create(null);
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i];
    if (!validKey(key) || typeof values[i + 1] !== "string") continue;
    try {
      const source = cleanSource(JSON.parse(values[i + 1]));
      if (source) sources[key] = source;
    } catch (_) {
      // Ignore damaged records and keep the rest of the public catalog available.
    }
  }
  return sources;
}

async function handleWrite(request, config) {
  if (!config.writable) return jsonResponse({ error: "Source editing is not configured" }, 503);
  if (!authorized(request, config.adminToken)) return jsonResponse({ error: "Unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const key = body && body.key;
  if (!validKey(key)) return jsonResponse({ error: "Invalid source key" }, 400);

  if (request.method === "POST") {
    const source = cleanSource(body);
    if (!source) return jsonResponse({ error: "Use a valid HTTPS source URL and source type" }, 400);
    try {
      const count = Number(await redisCommand(config, ["HLEN", SOURCES_HASH]));
      const exists = Number(await redisCommand(config, ["HEXISTS", SOURCES_HASH, key]));
      if (!exists && count >= MAX_SOURCES) return jsonResponse({ error: "Source library is full" }, 413);
      await redisCommand(config, ["HSET", SOURCES_HASH, key, JSON.stringify(source)]);
      return jsonResponse({ ok: true });
    } catch (_) {
      return jsonResponse({ error: "Shared source store is temporarily unavailable" }, 503);
    }
  }

  try {
    await redisCommand(config, ["HDEL", SOURCES_HASH, key]);
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
        const sources = await readSources(config);
        return jsonResponse({ configured: true, writable: config.writable, sources: sources });
      } catch (_) {
        return jsonResponse({ error: "Shared source store is temporarily unavailable" }, 503);
      }
    }

    if (request.method !== "POST" && request.method !== "DELETE") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    if (!config.configured || config.invalid) {
      return jsonResponse({ error: "Shared source store is not configured" }, 503);
    }
    return handleWrite(request, config);
  }
};
