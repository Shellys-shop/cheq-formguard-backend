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
      const { apiKey, tagHash, comprehensiveMode, phoneValidation } = body;

      if (!apiKey || !tagHash) {
              return res.status(400).json({ status: "ERROR", message: "apiKey and tagHash are required." });
      }

      const baseUrl = "https://api.hubapi.com";
      const headers = {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
      };

      const workflowName = "CHEQ Form Guard — Contact Validation";

      // Use legacy v3 workflows API (works with 'automation' scope)
      try {
              // Check for and delete existing workflow with same name
        const listRes = await fetch(`${baseUrl}/automation/v3/workflows`, { headers });
              if (listRes.ok) {
                        const listData = await listRes.json();
                        const existing = (listData.workflows || []).find(w => w.name === workflowName);
                        if (existing) {
                                    await fetch(`${baseUrl}/automation/v3/workflows/${existing.id}`, { method: "DELETE", headers });
                        }
              }
      } catch (e) { /* ignore */ }

      const cheqUrl = `https://rti-global.cheqzone.com/v3/user-validation/?ApiKey=${encodeURIComponent(apiKey)}&TagHash=${encodeURIComponent(tagHash)}&Mode=${comprehensiveMode ? "comprehensive" : "standard"}&EventType=form_submission`;

      const workflow = {
              name: workflowName,
              type: "PROPERTY_ANCHOR",
              enabled: true,
              insertedAt: Date.now(),
              actions: [
                  {
                              type: "WEBHOOK",
                              anchorSetting: {
                                            exectionTime: "IMMEDIATELY",
                              },
                              webhookSettings: {
                                            url: cheqUrl,
                                            method: "POST",
                                            propertyNamesToSend: ["email", "firstname", "lastname", phoneValidation ? "phone" : null].filter(Boolean),
                              },
                              actionType: "WEBHOOK",
                  }
                      ],
              segmentCriteria: [
                        [
                            {
                                          filterFamily: "ContactProperty",
                                          operator: "IS_NOT_EMPTY",
                                          property: "cq_req_id",
                                          type: "string",
                            }
                                  ]
                      ],
              allowContactToTriggerMultipleTimes: false,
              onlyEnrollsManually: false,
      };

      const createRes = await fetch(`${baseUrl}/automation/v3/workflows`, {
              method: "POST",
              headers,
              body: JSON.stringify(workflow),
      });

      const responseText = await createRes.text();
      let responseData;
      try { responseData = JSON.parse(responseText); } catch(e) { responseData = { raw: responseText }; }

      if (!createRes.ok) {
              return res.status(400).json({
                        status: "ERROR",
                        message: responseData.message || `HubSpot API error: ${createRes.status}`,
                        details: responseData,
              });
      }

      return res.status(200).json({
              status: "SUCCESS",
              message: `Workflow "${workflowName}" deployed successfully.`,
              workflowId: responseData.id,
      });
};
