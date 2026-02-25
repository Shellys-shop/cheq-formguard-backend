// api/save-config.js
// Validates CHEQ credentials and persists config to Vercel Blob keyed by portalId.
// Called from the HubSpot UI Extension via hubspot.fetch().

import { put, list } from "@vercel/blob";
const https = require("https");

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
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  setCached(portalId, config);
}

export async function loadConfig(portalId) {
  const cached = getCached(portalId);
  if (cached) return cached;

  const { blobs } = await list({ prefix: blobPath(portalId) });
  if (!blobs.length) return null;

  const response = await fetch(blobs[0].url);
  if (!response.ok) return null;

  const config = await response.json();
  setCached(portalId, config);
  return config;
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
  const {
    portalId, apiKey, tagHash, mode,
    observationMode, gibberishEngine, phoneValidation, comprehensiveMode,
  } = req.body;

  // hubspot.fetch() passes the OAuth token in the Authorization header
  const hsToken = req.headers.authorization?.replace("Bearer ", "") || null;

  if (!apiKey || !tagHash) {
    return res.status(400).json({ status: "ERROR", message: "API Key and Tag Hash are required." });
  }
  if (!portalId) {
    return res.status(400).json({ status: "ERROR", message: "portalId is required." });
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
