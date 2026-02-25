// api/oauth-callback.js
// Handles the OAuth redirect from HubSpot after app installation.
// Exchanges the authorization code for an access token, then redirects
// the user back to HubSpot.

export default async function handler(req, res) {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({
      status: "ERROR",
      message: "Missing authorization code.",
    });
  }

  // For now, just confirm the install succeeded and redirect to HubSpot
  // In a full implementation, you'd exchange the code for tokens here
  // using your app's client ID and secret.

  const html = `
    <!DOCTYPE html>
    <html>
    <head><title>CHEQ Form Guard — Installed</title></head>
    <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
      <div style="text-align: center;">
        <h1>CHEQ Form Guard Installed</h1>
        <p>The app has been connected to your HubSpot portal.</p>
        <p>You can close this tab and return to HubSpot.</p>
        <p style="margin-top: 2em;">
          <a href="https://app.hubspot.com" style="background: #ff5c35; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">
            Return to HubSpot
          </a>
        </p>
      </div>
    </body>
    </html>
  `;

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}
