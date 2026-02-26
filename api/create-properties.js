// api/create-properties.js
// Creates the CHEQ Form Guard property group and contact properties in HubSpot.
// Called from HubSpot UI Extension via hubspot.fetch().
//
// FIX: Loads the stored hsToken from Blob config (saved during Step 1)
// so properties are created using the portal's token, not the OAuth
// token from hubspot.fetch() which may have limited scopes.

import { loadConfig } from "./save-config.js";

const GROUP = {
  name: "cheq_formguard",
  label: "CHEQ Form Guard",
  displayOrder: -1,
};

const PROPERTIES = [
  {
    name: "cq_req_id",
    label: "CHEQ Request ID",
    description: "The unique RequestID captured by the CHEQ tag on form submission.",
    groupName: "cheq_formguard",
    type: "string",
    fieldType: "text",
    formField: true,
  },
  {
    name: "cq_action",
    label: "CHEQ Action",
    description: "Recommended action from CHEQ: allow, deny, or monitor.",
    groupName: "cheq_formguard",
    type: "enumeration",
    fieldType: "select",
    options: [
      { label: "Allow", value: "allow", displayOrder: 0, hidden: false, description: "" },
      { label: "Deny", value: "deny", displayOrder: 1, hidden: false, description: "" },
      { label: "Monitor", value: "monitor", displayOrder: 2, hidden: false, description: "" },
    ],
  },
  {
    name: "cq_verdict",
    label: "CHEQ Verdict",
    description: "Overall risk verdict from CHEQ Form Guard.",
    groupName: "cheq_formguard",
    type: "enumeration",
    fieldType: "select",
    options: [
      { label: "Valid", value: "valid", displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious", value: "malicious", displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown", value: "unknown", displayOrder: 3, hidden: false, description: "" },
    ],
  },
  {
    name: "cq_risk_score",
    label: "CHEQ Risk Score",
    description: "Risk score from CHEQ (0.00 = clean, 1.00 = high risk).",
    groupName: "cheq_formguard",
    type: "number",
    fieldType: "number",
  },
  {
    name: "cq_threat_type",
    label: "CHEQ Threat Type Code",
    description: "Numeric threat type code from CHEQ. 0 = no threat.",
    groupName: "cheq_formguard",
    type: "number",
    fieldType: "number",
  },
  {
    name: "cq_email_verdict",
    label: "CHEQ Email Verdict",
    description: "Verdict on the email address submitted by this contact.",
    groupName: "cheq_formguard",
    type: "enumeration",
    fieldType: "select",
    options: [
      { label: "Valid", value: "valid", displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious", value: "malicious", displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown", value: "unknown", displayOrder: 3, hidden: false, description: "" },
    ],
  },
  {
    name: "cq_phone_verdict",
    label: "CHEQ Phone Verdict",
    description: "Verdict on the phone number submitted by this contact.",
    groupName: "cheq_formguard",
    type: "enumeration",
    fieldType: "select",
    options: [
      { label: "Valid", value: "valid", displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious", value: "malicious", displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown", value: "unknown", displayOrder: 3, hidden: false, description: "" },
    ],
  },
  {
    name: "cq_last_checked",
    label: "CHEQ Last Checked",
    description: "Timestamp of the last CHEQ Form Guard validation.",
    groupName: "cheq_formguard",
    type: "datetime",
    fieldType: "date",
  },
];

async function hubspotRequest(path, method, body, token) {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = { message: `HTTP ${response.status}` };
  }
  return { status: response.status, data };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Try multiple token sources:
  // 1. Authorization header from hubspot.fetch() (OAuth token)
  // 2. Stored hsToken from config (private app token saved in Step 1)
  let token = req.headers.authorization?.replace("Bearer ", "") || null;
  const portalId = req.body?.portalId || req.query?.portalId || null;

  console.log("create-properties debug:", {
    hasAuthHeader: !!req.headers.authorization,
    tokenLength: token?.length,
    portalIdFromBody: req.body?.portalId,
    portalIdFromQuery: req.query?.portalId,
    resolvedPortalId: portalId,
  });

  // If we have a portalId, try to load the stored token which may have
  // broader scopes (e.g. crm.schemas.contacts.write)
  if (portalId) {
    try {
      const config = await loadConfig(String(portalId));
      if (config?.hsToken) {
        token = config.hsToken;
        console.log(`Using stored hsToken for portal ${portalId}`);
      } else {
        console.log(`No stored hsToken found for portal ${portalId}, using OAuth header token`);
      }
    } catch (err) {
      console.warn("Could not load config for stored token:", err.message);
    }
  }

  if (!token) {
    return res.status(401).json({
      status: "ERROR",
      message: "No authorization token available. Please save your configuration in Step 1 first, or ensure your app has the required OAuth scopes.",
    });
  }

  const results = { created: 0, skipped: 0, errors: [] };

  // 1. Create property group
  const groupResp = await hubspotRequest(
    "/crm/v3/properties/contacts/groups",
    "POST",
    GROUP,
    token
  );

  if (groupResp.status === 201) {
    console.log("Created group: cheq_formguard");
  } else if (groupResp.status === 409) {
    console.log("Group already exists");
  } else {
    console.error("Group creation error:", groupResp.status, groupResp.data);
    // Don't fail hard — the group might already exist with a different error code
  }

  // 2. Create each property
  for (const prop of PROPERTIES) {
    const propResp = await hubspotRequest(
      "/crm/v3/properties/contacts",
      "POST",
      prop,
      token
    );

    if (propResp.status === 201) {
      results.created++;
      console.log(`Created: ${prop.name}`);
    } else if (propResp.status === 409) {
      results.skipped++;
      console.log(`Already exists: ${prop.name}`);
    } else {
      const errMsg = propResp.data?.message || `HTTP ${propResp.status}`;
      results.errors.push({ name: prop.name, error: errMsg, status: propResp.status });
      console.error(`Failed to create ${prop.name}:`, propResp.status, errMsg);
    }
  }

  if (results.errors.length > 0) {
    // Check if all errors are permission-related
    const allForbidden = results.errors.every((e) => e.status === 403);
    const message = allForbidden
      ? `Permission denied. Your app needs the "crm.schemas.contacts.write" scope. Go to your Developer Account > Apps > CHEQ Form Guard > Auth > Scopes and add it, then re-install the app.`
      : `Some properties failed: ${results.errors.map((e) => `${e.name} (${e.error})`).join(", ")}`;

    return res.status(allForbidden ? 403 : 500).json({
      status: "ERROR",
      message,
      results,
    });
  }

  return res.status(200).json({
    status: "SUCCESS",
    message: `${results.created} properties created, ${results.skipped} already existed.`,
    results,
  });
}
