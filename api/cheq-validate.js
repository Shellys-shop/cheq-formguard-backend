// api/cheq-validate.js
// Webhook endpoint — loads portal config from Blob (with in-memory cache),
// calls CHEQ FormGuard, then writes results back to the HubSpot contact.

import { loadConfig } from "./save-config.js";
const https = require("https");

// ─── Call CHEQ API ──────────────────────────────────────────────────────────
function callCheqApi({ apiKey, tagHash, mode, reqId, email, phone, ip, userAgent }) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      ApiKey: apiKey,
      TagHash: tagHash,
      Email: email || "",
      Mode: mode || "comprehensive",
      EventType: "form_submission",
      AcceptLanguage: "en-US,en;q=0.9",
    });
    if (reqId) params.set("RequestID", reqId);
    if (phone) params.set("Phone", phone);
    if (ip) params.set("ClientIP", ip);
    if (userAgent) params.set("UserAgent", userAgent);

    const body = params.toString();
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
        try {
          resolve({ ok: true, data: JSON.parse(data) });
        } catch {
          resolve({ ok: false, error: `Failed to parse CHEQ response: ${data}` });
        }
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ ok: false, error: "CHEQ API timed out" });
    });
    req.write(body);
    req.end();
  });
}

// ─── Map CHEQ response → HubSpot contact properties ────────────────────────
function mapCheqToProperties(cheqData) {
  const resultMap = { 0: "allow", 1: "deny", 2: "monitor" };
  const props = { cq_last_checked: new Date().toISOString() };

  if (cheqData.result !== undefined) props.cq_action = resultMap[cheqData.result] ?? "monitor";
  if (cheqData.verdict !== undefined) props.cq_verdict = cheqData.verdict;
  if (cheqData.riskScore !== undefined) props.cq_risk_score = String(cheqData.riskScore);
  if (cheqData.threatTypeCode !== undefined) props.cq_threat_type = String(cheqData.threatTypeCode);
  if (cheqData.emailVerdict !== undefined) props.cq_email_verdict = cheqData.emailVerdict;
  if (cheqData.phoneVerdict !== undefined) props.cq_phone_verdict = cheqData.phoneVerdict;

  return props;
}

// ─── HubSpot: update contact ────────────────────────────────────────────────
function updateHubSpotContact(contactId, properties, hsToken) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ properties });
    const options = {
      hostname: "api.hubapi.com",
      path: `/crm/v3/objects/contacts/${contactId}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${hsToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, ok: res.statusCode < 300 }));
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve({ ok: false, error: "HubSpot PATCH timed out" });
    });
    req.write(body);
    req.end();
  });
}

// ─── HubSpot: find contact by email ────────────────────────────────────────
function findContactByEmail(email, hsToken) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["email"],
      limit: 1,
    });
    const options = {
      hostname: "api.hubapi.com",
      path: "/crm/v3/objects/contacts/search",
      method: "POST",
      headers: {
        Authorization: `Bearer ${hsToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          resolve(json.results?.[0]?.id ?? null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

// ─── Parse HubSpot webhook body ─────────────────────────────────────────────
function parseBody(body) {
  if (body?.data && Array.isArray(body.data)) {
    const fields = Object.fromEntries(body.data.map((f) => [f.name, f.value]));
    return {
      portalId: body.portalId,
      contactId: body.contactId || body.vid,
      email: fields.email,
      phone: fields.phone || fields.mobilephone,
      cqReqId: fields.cq_req_id,
      ip: null,
      userAgent: null,
    };
  }
  return {
    portalId: body?.portalId,
    contactId: body?.contactId || body?.hs_object_id || body?.vid,
    email: body?.email,
    phone: body?.phone || body?.mobilephone,
    cqReqId: body?.cq_req_id,
    ip: body?.ip,
    userAgent: body?.userAgent,
  };
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { portalId, contactId: rawContactId, email, phone, cqReqId, ip, userAgent } = parseBody(req.body);

  if (!portalId) {
    return res.status(400).json({
      status: "ERROR",
      message: "portalId is required. Add it to your webhook payload so the backend knows which CHEQ config to use.",
    });
  }
  if (!email) {
    return res.status(400).json({ status: "ERROR", message: "email is required in the webhook payload." });
  }

  let config;
  try {
    config = await loadConfig(String(portalId));
  } catch (err) {
    console.error("loadConfig error:", err);
    return res.status(500).json({ status: "ERROR", message: "Failed to load portal config." });
  }

  if (!config) {
    return res.status(404).json({
      status: "ERROR",
      message: `No config found for portal ${portalId}. Complete Step 1 in CHEQ Form Guard settings first.`,
    });
  }

  const { apiKey, tagHash, mode, observationMode, hsToken } = config;

  if (!apiKey || !tagHash) {
    return res.status(500).json({ status: "ERROR", message: "CHEQ credentials missing from config." });
  }
  if (!hsToken) {
    return res.status(500).json({ status: "ERROR", message: "HubSpot token missing from config. Please re-save settings." });
  }

  let contactId = rawContactId;
  if (!contactId) {
    contactId = await findContactByEmail(email, hsToken);
    if (!contactId) {
      return res.status(404).json({ status: "ERROR", message: `No HubSpot contact found for email: ${email}` });
    }
  }

  const cheqResult = await callCheqApi({ apiKey, tagHash, mode, reqId: cqReqId, email, phone, ip, userAgent });
  if (!cheqResult.ok) {
    return res.status(502).json({ status: "ERROR", message: `CHEQ API error: ${cheqResult.error}` });
  }

  const properties = mapCheqToProperties(cheqResult.data);

  if (observationMode) {
    console.log(`[OBSERVATION] portal=${portalId} contact=${contactId}`, properties);
    return res.status(200).json({
      status: "SUCCESS",
      observationMode: true,
      message: "Observation mode — results logged but not written to contact.",
      contactId, email, properties,
    });
  }

  const update = await updateHubSpotContact(contactId, properties, hsToken);
  if (!update.ok) {
    return res.status(502).json({
      status: "ERROR",
      message: `Failed to update HubSpot contact (HTTP ${update.status}). Check token has crm.objects.contacts.write scope.`,
      contactId,
      cheqResult: cheqResult.data,
    });
  }

  return res.status(200).json({
    status: "SUCCESS",
    message: "Contact validated and updated.",
    contactId, email,
    action: properties.cq_action,
    verdict: properties.cq_verdict,
    riskScore: properties.cq_risk_score,
  });
}
