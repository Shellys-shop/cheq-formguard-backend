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

    const body = req.body || {};
    const { apiKey, tagHash, triggerMode, comprehensiveMode, phoneValidation } = body;

    if (!apiKey || !tagHash) {
          return res.status(400).json({ status: "ERROR", message: "apiKey and tagHash are required." });
    }

    const baseUrl = "https://api.hubapi.com";
    const headers = {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
    };

    const workflowName = "CHEQ Form Guard — Contact Validation";

    try {
          const listRes = await fetch(`${baseUrl}/automation/v4/flows?limit=100`, { headers });
          if (listRes.ok) {
                  const listData = await listRes.json();
                  const existing = (listData.results || []).find(w => w.name === workflowName);
                  if (existing) {
                            await fetch(`${baseUrl}/automation/v4/flows/${existing.id}`, { method: "DELETE", headers });
                  }
          }
    } catch (e) { /* ignore */ }

    const cheqParams = new URLSearchParams({
          ApiKey: apiKey,
          TagHash: tagHash,
          RequestID: "{% contact.cq_req_id %}",
          Email: "{% contact.email %}",
          FirstName: "{% contact.firstname %}",
          LastName: "{% contact.lastname %}",
          Phone: phoneValidation ? "{% contact.phone %}" : "",
          Mode: comprehensiveMode ? "comprehensive" : "standard",
          EventType: "form_submission",
    });

    const workflow = {
          name: workflowName,
          type: "CONTACT_DATE_PROPERTY",
          enabled: true,
          enrollmentCriteria: {
                  type: "AND",
                  filters: [{ property: "cq_req_id", operation: { operator: "IS_KNOWN" } }]
          },
          actions: [
            {
                      type: "WEBHOOK",
                      url: `https://rti-global.cheqzone.com/v3/user-validation/?${cheqParams.toString()}`,
                      method: "POST",
                      propertyMappings: [
                        { sourceProperty: "action",       targetProperty: "cq_action"        },
                        { sourceProperty: "verdict",      targetProperty: "cq_verdict"       },
                        { sourceProperty: "riskScore",    targetProperty: "cq_risk_score"    },
                        { sourceProperty: "threatType",   targetProperty: "cq_threat_type"   },
                        { sourceProperty: "emailVerdict", targetProperty: "cq_email_verdict" },
                        { sourceProperty: "phoneVerdict", targetProperty: "cq_phone_verdict" },
                                ],
            },
            {
                      type: "SET_CONTACT_PROPERTY",
                      propertyName: "cq_last_checked",
                      value: "{% NOW %}",
            }
                ],
    };

    const createRes = await fetch(`${baseUrl}/automation/v4/flows`, {
          method: "POST",
          headers,
          body: JSON.stringify(workflow),
    });

    if (!createRes.ok) {
          const err = await createRes.json();
          return res.status(400).json({
                  status: "ERROR",
                  message: err.message || `HubSpot API error: ${createRes.status}`,
                  details: err,
          });
    }

    const created = await createRes.json();
    return res.status(200).json({
          status: "SUCCESS",
          message: `Workflow "${workflowName}" deployed successfully.`,
          workflowId: created.id,
    });
};
