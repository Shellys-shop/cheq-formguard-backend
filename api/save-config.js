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
      UserAgent: "HubSpot-CHEQ-FormGuard/1.0",
    }).toString();

    const options = {
      hostname: "rti-global.cheqzone.com",
      path: "/v3/user-validation/",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if ([200, 201, 400].includes(res.statusCode)) {
          resolve({ valid: true });
        } else if (res.statusCode === 401) {
          resolve({ valid: false, error: "Invalid API Key or Tag Hash." });
        } else {
          resolve({ valid: false, error: `Unexpected CHEQ response: ${res.statusCode}` });
        }
      });
    });

    req.on("error", (err) => resolve({ valid: false, error: `Network error: ${err.message}` }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ valid: false, error: "Request timed out." }); });
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://app.hubspot.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { apiKey, tagHash, hostDomain, triggerMode, observationMode,
          gibberishEngine, phoneValidation, comprehensiveMode } = req.body;

  if (!apiKey || !tagHash) {
    return res.status(400).json({ status: "ERROR", message: "API Key and Tag Hash are required." });
  }

  const validation = await testCheqCredentials(apiKey, tagHash);
  if (!validation.valid) {
    return res.status(400).json({ status: "ERROR", message: validation.error });
  }

  return res.status(200).json({
    status: "SUCCESS",
    message: "Credentials validated successfully.",
    config: { apiKey, tagHash, hostDomain, triggerMode, observationMode,
              gibberishEngine, phoneValidation, comprehensiveMode },
  });
};
