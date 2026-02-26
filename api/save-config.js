// api/save-config.js
// Validates CHEQ credentials and persists config to Vercel Blob keyed by portalId.
// Called from the HubSpot UI Extension via hubspot.fetch().

import { put, get } from "@vercel/blob";
const https = require("https");

// ─── Token refresh helper ────────────────────────────────────────────────────
export async function getValidToken(portalId) {
  const config = await loadConfig(String(portalId));
  if (!config) return null;

  // If token is still valid (with 5 min buffer), return it
  if (config.hsToken && config.tokenExpiresAt && Date.now() < (config.tokenExpiresAt - 300000)) {
    return config.hsToken;
  }

  // Token expired — try to refresh
  if (config.refreshToken) {
    const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
    const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.warn("Cannot refresh token: missing CLIENT_ID/SECRET env vars");
      // Return expired token as last resort — it might still work briefly
      return config.hsToken || null;
    }

    try {
      const resp = await fetch("https://api.hubapi.com/oauth/v1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: config.refreshToken,
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        config.hsToken = data.access_token;
        if (data.refresh_token) config.refreshToken = data.refresh_token;
        config.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        await saveConfig(String(portalId), config);
        console.log("Refreshed OAuth token for portal", portalId);
        return data.access_token;
      } else {
        const err = await resp.json();
        console.error("Token refresh failed:", err);
      }
    } catch (err) {
      console.error("Token refresh error:", err);
    }
  }

  // Return whatever token we have, even if expired
  return config.hsToken || null;
}

// ─── In-memory cache ────────────────────────────────────────────────────────
const configCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(portalId) {
  const entry = configCache.get(portalId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    configCache.delete(portalId);
    return null;
  }
  return entry.config;
}

function setCached(portalId, config) {
  configCache.set(portalId, { config, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Blob helpers ───────────────────────────────────────────────────────────
const blobPath = (portalId) => `configs/portal-${portalId}.json`;

export async function saveConfig(portalId, config) {
  await put(blobPath(portalId), JSON.stringify(config), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  setCached(portalId, config);
}

export async function loadConfig(portalId) {
  const cached = getCached(portalId);
  if (cached) return cached;

  try {
    const response = await get(blobPath(portalId), { access: "private" });
    if (!response || !response.stream) return null;

    const reader = response.stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    const config = JSON.parse(text);
    setCached(portalId, config);
    return config;
  } catch (err) {
    // Blob not found returns an error
    if (err?.message?.includes("not found") || err?.code === "blob_not_found") {
      return null;
    }
    console.error("loadConfig error for portal", portalId, err);
    return null;
  }
}

// ─── Validate CHEQ credentials ──────────────────────────────────────────────
function testCheqCredentials(apiKey, tagHash) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      ApiKey: apiKey,
      TagHash: tagHash,
      RequestID: "test-hubspot-formguard-000000000000000",
      Email: "test@example.com",
      Mode: "comprehensive",
      EventType: "form_submission",
      AcceptLanguage: "en-US,en;q=0.9",
      ClientIP: "1.1.1.1",
      UserAgent: "HubSpot-CHEQ-FormGuard/2.0",
    }).toString();

    const options = {
      hostname: "rti-global.cheqzone.com",
      path: "/v3/user-validation/",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
        Connection: "keep-alive",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if ([200, 201, 400].includes(res.statusCode)) {
          resolve({ valid: true });
        } else if (res.statusCode === 401) {
          resolve({ valid: false, error: "Invalid API Key or Tag Hash. Please check your CHEQ Platform credentials." });
        } else {
          resolve({ valid: false, error: `Unexpected response from CHEQ API: ${res.statusCode}` });
        }
      });
    });

    req.on("error", (err) => resolve({ valid: false, error: `Network error: ${err.message}` }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ valid: false, error: "Request timed out." });
    });
    req.write(body);
    req.end();
  });
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── GET — load saved config ──
  if (req.method === "GET") {
    const { portalId } = req.query;
    if (!portalId) return res.status(400).json({ status: "ERROR", message: "portalId required" });

    try {
      const config = await loadConfig(portalId);
      if (!config) return res.status(404).json({ status: "NOT_FOUND" });

      const { apiKey, tagHash, hsToken, ...safe } = config;
      return res.status(200).json({
        status: "SUCCESS",
        config: {
          ...safe,
          apiKey: apiKey ? `${apiKey.slice(0, 4)}${"*".repeat(Math.max(0, apiKey.length - 4))}` : "",
          tagHash: tagHash ? `${tagHash.slice(0, 4)}${"*".repeat(Math.max(0, tagHash.length - 4))}` : "",
          apiKeySet: !!apiKey,
          tagHashSet: !!tagHash,
          hsTokenSet: !!hsToken,
        },
      });
    } catch (err) {
      console.error("loadConfig error:", err);
      return res.status(500).json({ status: "ERROR", message: "Failed to load config." });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── POST — validate credentials + save config ──
  // hubspot.fetch() passes the OAuth token in the Authorization header
  const hsToken = req.headers.authorization?.replace("Bearer ", "") || null;

  // Try body first, then query string as fallback
  const portalId = req.body?.portalId || req.query?.portalId || null;
  const apiKey = req.body?.apiKey;
  const tagHash = req.body?.tagHash;
  const mode = req.body?.mode;
  const observationMode = req.body?.observationMode;
  const gibberishEngine = req.body?.gibberishEngine;
  const phoneValidation = req.body?.phoneValidation;
  const comprehensiveMode = req.body?.comprehensiveMode;

  // Debug logging
  console.log("POST /api/save-config", {
    bodyType: typeof req.body,
    bodyKeys: req.body ? Object.keys(req.body) : "null",
    portalIdFromBody: req.body?.portalId,
    portalIdFromQuery: req.query?.portalId,
    resolvedPortalId: portalId,
    hasApiKey: !!apiKey,
    hasTagHash: !!tagHash,
    contentType: req.headers["content-type"],
  });

  if (!apiKey || !tagHash) {
    return res.status(400).json({ status: "ERROR", message: "API Key and Tag Hash are required." });
  }
  if (!portalId) {
    return res.status(400).json({
      status: "ERROR",
      message: `portalId is required. Debug: body=${JSON.stringify(req.body?.portalId)}, query=${JSON.stringify(req.query?.portalId)}, bodyType=${typeof req.body}, bodyKeys=${req.body ? Object.keys(req.body).join(",") : "null"}`,
    });
  }

  const validation = await testCheqCredentials(apiKey, tagHash);
  if (!validation.valid) {
    return res.status(400).json({ status: "ERROR", message: validation.error });
  }

  const config = {
    portalId: String(portalId),
    apiKey,
    tagHash,
    hsToken,
    mode: comprehensiveMode !== false ? "comprehensive" : (mode || "standard"),
    observationMode: observationMode === true || observationMode === "true",
    gibberishEngine: gibberishEngine !== false,
    phoneValidation: phoneValidation !== false,
    savedAt: new Date().toISOString(),
  };

  try {
    await saveConfig(String(portalId), config);
    console.log(`Config saved to Blob for portal ${portalId}`);
  } catch (err) {
    console.error("Blob save error:", err);
    return res.status(500).json({
      status: "ERROR",
      message: "Credentials validated but failed to save. Ensure Vercel Blob is connected to this project.",
    });
  }

  return res.status(200).json({
    status: "SUCCESS",
    message: "Configuration saved and credentials validated.",
    webhookUrl: "https://cheq-formguard-backend.vercel.app/api/cheq-validate",
  });
}
