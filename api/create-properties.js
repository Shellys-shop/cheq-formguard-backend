module.exports = async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const token = process.env.HUBSPOT_ACCESS_TOKEN ||
          (req.headers.authorization && req.headers.authorization.replace("Bearer ", ""));

    if (!token) {
          return res.status(400).json({ status: "ERROR", message: "No HubSpot access token configured." });
    }

    const baseUrl = "https://api.hubapi.com";
    const headers = {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
    };

    const results = { created: [], skipped: [], errors: [] };

    try {
          const groupRes = await fetch(`${baseUrl}/crm/v3/properties/contacts/groups`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ name: "cheq_formguard", label: "CHEQ Form Guard", displayOrder: 1 }),
          });
          if (groupRes.ok || groupRes.status === 409) results.created.push("cheq_formguard group");
    } catch (err) {
          results.errors.push(`Group: ${err.message}`);
    }

    const properties = [
      { name: "cq_req_id",        label: "CHEQ Request ID",    fieldType: "text",   type: "string"   },
      { name: "cq_action",        label: "CHEQ Action",        fieldType: "text",   type: "string"   },
      { name: "cq_verdict",       label: "CHEQ Verdict",       fieldType: "text",   type: "string"   },
      { name: "cq_risk_score",    label: "CHEQ Risk Score",    fieldType: "number", type: "number"   },
      { name: "cq_threat_type",   label: "CHEQ Threat Type",   fieldType: "text",   type: "string"   },
      { name: "cq_email_verdict", label: "CHEQ Email Verdict", fieldType: "text",   type: "string"   },
      { name: "cq_phone_verdict", label: "CHEQ Phone Verdict", fieldType: "text",   type: "string"   },
      { name: "cq_last_checked",  label: "CHEQ Last Checked",  fieldType: "date",   type: "datetime" },
        ];

    for (const prop of properties) {
          try {
                  const propRes = await fetch(`${baseUrl}/crm/v3/properties/contacts`, {
                            method: "POST",
                            headers,
                            body: JSON.stringify({
                                        name: prop.name,
                                        label: prop.label,
                                        type: prop.type,
                                        fieldType: prop.fieldType,
                                        groupName: "cheq_formguard",
                                        description: `CHEQ Form Guard: ${prop.label}`,
                            }),
                  });
                  if (propRes.ok) {
                            results.created.push(prop.name);
                  } else if (propRes.status === 409) {
                            results.skipped.push(prop.name);
                  } else {
                            const err = await propRes.json();
                            results.errors.push(`${prop.name}: ${err.message || propRes.status}`);
                  }
          } catch (err) {
                  results.errors.push(`${prop.name}: ${err.message}`);
          }
    }

    return res.status(200).json({
          status: "SUCCESS",
          message: `Created: ${results.created.length}, Skipped (already exist): ${results.skipped.length}, Errors: ${results.errors.length}`,
          details: results,
    });
};
