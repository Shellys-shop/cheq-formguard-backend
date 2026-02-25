// api/create-workflow.js
// Creates the CHEQ Form Guard validation workflow in HubSpot.
// Called from HubSpot UI Extension via hubspot.fetch().

import { loadConfig } from "./save-config.js";

const WORKFLOW_NAME = "CHEQ Form Guard — Contact Validation";
const CHEQ_ENDPOINT = "https://rti-global.cheqzone.com/v3/user-validation/";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Try header token first, then stored config token
  let token = req.headers.authorization?.replace("Bearer ", "") || null;
  const portalId = req.body?.portalId;

  if (portalId) {
    try {
      const config = await loadConfig(String(portalId));
      if (config?.hsToken) token = config.hsToken;
    } catch (err) {
      console.warn("Could not load config for stored token:", err.message);
    }
  }

  if (!token) {
    return res.status(401).json({ status: "ERROR", message: "Missing authorization." });
  }

  const {
    apiKey, tagHash,
    triggerMode = "contact_created",
    comprehensiveMode = true,
    phoneValidation = true,
  } = req.body;

  if (!apiKey || !tagHash) {
    return res.status(400).json({ status: "ERROR", message: "apiKey and tagHash are required." });
  }

  const mode = comprehensiveMode ? "comprehensive" : "standard";

  const cheqRequestBody = [
    `ApiKey=${encodeURIComponent(apiKey)}`,
    `TagHash=${encodeURIComponent(tagHash)}`,
    `RequestID={% contact.cq_req_id %}`,
    `Email={% contact.email %}`,
    `Mode=${mode}`,
    `EventType=form_submission`,
    `AcceptLanguage=en-US%2Cen%3Bq%3D0.9`,
    `firstName={% contact.firstname %}`,
    `lastName={% contact.lastname %}`,
    phoneValidation ? `Phone={% contact.phone %}` : null,
  ].filter(Boolean).join("&");

  // Delete existing workflow with same name
  try {
    const listResp = await fetch("https://api.hubapi.com/automation/v4/flows", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listResp.json();
    const existing = (listData.results || []).find((w) => w.name === WORKFLOW_NAME);
    if (existing) {
      await fetch(`https://api.hubapi.com/automation/v4/flows/${existing.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(`Deleted existing workflow: ${existing.id}`);
    }
  } catch (e) {
    console.warn("Could not check/delete existing workflow:", e.message);
  }

  const enrollmentCriteria = {
    shouldReEnroll: false,
    type: triggerMode === "form_submission" ? "PROPERTY_VALUE" : "CONTACT_CREATED",
    ...(triggerMode === "form_submission" && {
      propertyName: "cq_req_id",
      operator: "SET_ANY_VALUE",
    }),
    filterBranches: {
      filterBranchType: "AND",
      filterBranchOperator: "AND",
      filters: [{
        filterType: "PROPERTY",
        property: "cq_req_id",
        operation: { operationType: "MULTISTRING", operator: "IS_KNOWN" },
      }],
      filterBranches: [],
    },
  };

  if (triggerMode === "both") {
    enrollmentCriteria.type = "CONTACT_CREATED";
    enrollmentCriteria.shouldReEnroll = true;
  }

  const workflowDef = {
    name: WORKFLOW_NAME,
    type: "CONTACT_DATE_PROPERTY",
    enabled: true,
    enrollmentCriteria,
    actions: [
      {
        type: "WEBHOOK",
        fields: {
          url: CHEQ_ENDPOINT,
          method: "POST",
          contentType: "APPLICATION_X_WWW_FORM_URLENCODED",
          requestBody: cheqRequestBody,
          responsePropertyMappings: [
            { responsePath: "action", contactProperty: "cq_action" },
            { responsePath: "detected_verdict", contactProperty: "cq_verdict" },
            { responsePath: "risk_score", contactProperty: "cq_risk_score" },
            { responsePath: "threat_type_code", contactProperty: "cq_threat_type" },
            { responsePath: "user.email.verdict", contactProperty: "cq_email_verdict" },
            { responsePath: "user.phone.verdict", contactProperty: "cq_phone_verdict" },
            { responsePath: "request_id", contactProperty: "cq_req_id" },
          ],
        },
      },
      {
        type: "SET_CONTACT_PROPERTY",
        fields: {
          propertyName: "cq_last_checked",
          value: "{% NOW %}",
        },
      },
    ],
  };

  const createResp = await fetch("https://api.hubapi.com/automation/v4/flows", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(workflowDef),
  });

  const createData = await createResp.json();

  if (createData.id) {
    return res.status(200).json({
      status: "SUCCESS",
      message: `Workflow "${WORKFLOW_NAME}" created successfully.`,
      workflowId: createData.id,
      workflowName: createData.name,
    });
  }

  return res.status(500).json({
    status: "ERROR",
    message: createData?.message || "Failed to create workflow.",
    details: createData,
  });
}
