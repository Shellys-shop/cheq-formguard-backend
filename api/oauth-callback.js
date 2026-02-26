// api/oauth-callback.js
// Handles the OAuth redirect from HubSpot after app installation.
// Exchanges the authorization code for access + refresh tokens,
// stores them in Blob, then shows a success page.

import { saveConfig, loadConfig } from "./save-config.js";

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      status: "ERROR",
      message: "Missing authorization code.",
    });
  }

  const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID;
  const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
  const REDIRECT_URI = "https://cheq-formguard-backend.vercel.app/api/oauth-callback";

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET env vars");
    return res.status(500).send(errorPage("Server misconfiguration: missing OAuth credentials."));
  }

  // Exchange authorization code for tokens
  let tokenData;
  try {
    const tokenResp = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });

    tokenData = await tokenResp.json();

    if (!tokenResp.ok) {
      console.error("Token exchange failed:", tokenData);
      return res.status(400).send(errorPage("Token exchange failed: " + (tokenData.message || JSON.stringify(tokenData))));
    }
  } catch (err) {
    console.error("Token exchange error:", err);
    return res.status(500).send(errorPage("Failed to exchange authorization code."));
  }

  const { access_token, refresh_token, expires_in } = tokenData;

  // Get portal ID from the access token info
  let portalId;
  try {
    const infoResp = await fetch("https://api.hubapi.com/oauth/v1/access-tokens/" + access_token);
    const info = await infoResp.json();
    portalId = info.hub_id || info.hubId;
    console.log("OAuth token info:", { portalId, scopes: info.scopes, expiresIn: expires_in });
  } catch (err) {
    console.error("Failed to get token info:", err);
  }

  // Store tokens in Blob config
  if (portalId) {
    try {
      let config = {};
      try {
        const existing = await loadConfig(String(portalId));
        if (existing) config = existing;
      } catch (e) {
        // No existing config
      }

      config.portalId = String(portalId);
      config.hsToken = access_token;
      config.refreshToken = refresh_token;
      config.tokenExpiresAt = Date.now() + (expires_in * 1000);
      config.oauthConnectedAt = new Date().toISOString();

      await saveConfig(String(portalId), config);
      console.log("OAuth tokens saved for portal " + portalId);
    } catch (err) {
      console.error("Failed to save OAuth tokens:", err);
    }
  }

  const html = '<!DOCTYPE html><html><head><title>CHEQ Form Guard - Installed</title></head><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;"><div style="text-align:center;"><h1>CHEQ Form Guard Installed</h1><p>Connected to portal ' + (portalId || 'unknown') + '. OAuth tokens saved.</p><p style="margin-top:2em;"><a href="https://app.hubspot.com" style="background:#ff5c35;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">Return to HubSpot</a></p></div></body></html>';

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}

function errorPage(message) {
  return '<!DOCTYPE html><html><head><title>CHEQ Form Guard - Error</title></head><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;"><div style="text-align:center;"><h1>Installation Error</h1><p>' + message + '</p><p style="margin-top:2em;"><a href="https://app.hubspot.com" style="background:#ff5c35;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;">Return to HubSpot</a></p></div></body></html>';
}
