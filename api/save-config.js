// api/save-config.js
// Validates CHEQ credentials by making a test API call
// Called from HubSpot UI Extension via hubspot.fetch()

const https = require("https");

function testCheqCredentials(apiKey, tagHash) {
  return new Promise((resolve) => {
    const body = new URLSearchParams({
      ApiKey: apiKey,
      TagHash: tagHash,
      RequestID: "test-hubspot-poc-000000000000000",
      Email: "test@example.com",
      Mode: "comprehensive",
      EventType: "form_submission",
      AcceptLanguage: "en-US,en;q=0.9",
      ClientIP: "1.1.1.1",
      UserAgent: "HubSpot-CHEQ-FormGuard-PoC/1.0",
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
        // 200, 201, 400 all mean credentials are valid
        // (400 just means our test payload is incomplete, not that auth failed)
        if ([200, 201, 400].includes(res.statusCode)) {
          resolve({ valid: true, statusCode: res.statusCode });
        } else if (res.statusCode === 401) {
          resolve({ valid: false, error: "Invalid API Key or Tag Hash. Please check your CHEQ Platform credentials." });
        } else {
          resolve({ valid: false, error: `Unexpected response from CHEQ API: ${res.statusCode}` });
        }
      });
    });

    req.on("error", (err) => resolve({ valid: false, error: `Network error: ${err.message}` }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: "Request timed out." }); });
    req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  // CORS headers — HubSpot UI Extensions require this
  res.setHeader("Access-Control-Allow-Origin", "https://app.hubspot.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { apiKey, tagHash, hostDomain, triggerMode, observationMode,
          gibberishEngine, phoneValidation, comprehensiveMode,
          applyToContacts, applyToLeads } = req.body;

  if (!apiKey || !tagHash) {
    return res.status(400).json({ status: "ERROR", message: "API Key and Tag Hash are required." });
  }

  // Validate against CHEQ API
  const validation = await testCheqCredentials(apiKey, tagHash);
  if (!validation.valid) {
    return res.status(400).json({ status: "ERROR", message: validation.error });
  }

  // In production: persist to a DB or encrypted store
  // For PoC: return success — config is stored in Vercel env vars set manually
  return res.status(200).json({
    status: "SUCCESS",
    message: "Credentials validated successfully.",
    config: { apiKey, tagHash, hostDomain, triggerMode, observationMode,
              gibberishEngine, phoneValidation, comprehensiveMode,
              applyToContacts, applyToLeads },
  });
}
