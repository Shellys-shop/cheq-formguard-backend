const GROUP = {
  name: "cheq_formguard",
  label: "CHEQ Form Guard",
  displayOrder: -1,
};

const PROPERTIES = [
  { name: "cq_req_id",        label: "CHEQ Request ID",      groupName: "cheq_formguard", type: "string",       fieldType: "text",   formField: true },
  { name: "cq_action",        label: "CHEQ Action",          groupName: "cheq_formguard", type: "enumeration",  fieldType: "select",
    options: [
      { label: "Allow",   value: "allow",   displayOrder: 0, hidden: false, description: "" },
      { label: "Deny",    value: "deny",    displayOrder: 1, hidden: false, description: "" },
      { label: "Monitor", value: "monitor", displayOrder: 2, hidden: false, description: "" },
    ]},
  { name: "cq_verdict",       label: "CHEQ Verdict",         groupName: "cheq_formguard", type: "enumeration",  fieldType: "select",
    options: [
      { label: "Valid",      value: "valid",      displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious",  value: "malicious",  displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown",    value: "unknown",    displayOrder: 3, hidden: false, description: "" },
    ]},
  { name: "cq_risk_score",    label: "CHEQ Risk Score",      groupName: "cheq_formguard", type: "number",       fieldType: "number"  },
  { name: "cq_threat_type",   label: "CHEQ Threat Type",     groupName: "cheq_formguard", type: "number",       fieldType: "number"  },
  { name: "cq_email_verdict", label: "CHEQ Email Verdict",   groupName: "cheq_formguard", type: "enumeration",  fieldType: "select",
    options: [
      { label: "Valid",      value: "valid",      displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious",  value: "malicious",  displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown",    value: "unknown",    displayOrder: 3, hidden: false, description: "" },
    ]},
  { name: "cq_phone_verdict", label: "CHEQ Phone Verdict",   groupName: "cheq_formguard", type: "enumeration",  fieldType: "select",
    options: [
      { label: "Valid",      value: "valid",      displayOrder: 0, hidden: false, description: "" },
      { label: "Malicious",  value: "malicious",  displayOrder: 1, hidden: false, description: "" },
      { label: "Suspicious", value: "suspicious", displayOrder: 2, hidden: false, description: "" },
      { label: "Unknown",    value: "unknown",    displayOrder: 3, hidden: false, description: "" },
    ]},
  { name: "cq_last_checked",  label: "CHEQ Last Checked",    groupName: "cheq_formguard", type: "datetime",     fieldType: "date"    },
];

async function hubspotRequest(path, method, body, token) {
  const response = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://app.hubspot.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ status: "ERROR", message: "Missing Authorization header." });

  const results = { created: 0, skipped: 0, errors: [] };

  const groupResp = await hubspotRequest("/crm/v3/properties/contacts/groups", "POST", GROUP, token);
  if (groupResp.status !== 201 && groupResp.status !== 409) {
    console.error("Group error:", groupResp.data);
  }

  for (const prop of PROPERTIES) {
    const r = await hubspotRequest("/crm/v3/properties/contacts", "POST", prop, token);
    if (r.status === 201) results.created++;
    else if (r.status === 409) results.skipped++;
    else results.errors.push({ name: prop.name, error: r.data?.message });
  }

  if (results.errors.length > 0) {
    return res.status(500).json({ status: "ERROR", message: `Some properties failed: ${results.errors.map(e => e.name).join(", ")}`, results });
  }

  return res.status(200).json({
    status: "SUCCESS",
    message: `${results.created} properties created, ${results.skipped} already existed.`,
    results,
  });
};
