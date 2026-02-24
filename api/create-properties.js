// api/create-properties.js
// Creates the CHEQ Form Guard property group and contact properties in HubSpot
// Called from HubSpot UI Extension via hubspot.fetch()

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
      { label: "Allow",   value: "allow",   displayOrder: 0, hidden: false, description: "" },
      { label: "Deny",    value: "deny",    displayOrder: 1, hidden: false, description: "" },
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
      { label: "Valid",      value: "valid",      displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious",  value: "malicious",  displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown",    value: "unknown",    displayOrder: 3, hidden: false, description: "" },
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
      { label: "Valid",      value: "valid",      displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious",  value: "malicious",  displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown",    value: "unknown",    displayOrder: 3, hidden: false, description: "" },
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
      { label: "Valid",      value: "valid",      displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious",  value: "malicious",  displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown",    value: "unknown",    displayOrder: 3, hidden: false, description: "" },
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
  return { status: response.status, data: await response.json() };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://app.hubspot.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // HubSpot passes the portal access token in Authorization header
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ status: "ERROR", message: "Missing Authorization header." });
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
    console.error("Group creation error:", groupResp.data);
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
    } else if (propResp.status === 409) {
      results.skipped++;
    } else {
      results.errors.push({ name: prop.name, error: propResp.data?.message });
    }
  }

  if (results.errors.length > 0) {
    return res.status(500).json({
      status: "ERROR",
      message: `Some properties failed: ${results.errors.map((e) => e.name).join(", ")}`,
      results,
    });
  }

  return res.status(200).json({
    status: "SUCCESS",
    message: `${results.created} properties created, ${results.skipped} already existed.`,
    results,
  });
}
