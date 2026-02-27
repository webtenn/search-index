/**
 * Webflow Publish Webhook Handler
 * 
 * Webflow fires this endpoint when a CMS item is published or unpublished.
 * This function forwards the event to GitHub, triggering the sync workflow.
 * 
 * Deploy this as a Vercel serverless function or Cloudflare Worker.
 * 
 * Required environment variables:
 *   GH_PAT          — GitHub Personal Access Token (repo scope)
 *   GH_OWNER        — Your GitHub username or org (e.g. "your-company")
 *   GH_REPO         — Your repo name (e.g. "search-index")
 *   WEBHOOK_SECRET  — A secret string you set in Webflow webhook config
 *                     to verify requests are genuinely from Webflow
 */

export default async function handler(req, res) {
  // ── Only accept POST requests ─────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Verify the request is from Webflow ────────────────────────────────────
  const secret = req.headers["x-webhook-secret"];
  if (secret !== process.env.WEBHOOK_SECRET) {
    console.error("Unauthorized webhook attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { GH_PAT, GH_OWNER, GH_REPO } = process.env;

  if (!GH_PAT || !GH_OWNER || !GH_REPO) {
    console.error("Missing GitHub environment variables");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  try {
    // ── Trigger the GitHub Actions workflow via repository_dispatch ──────────
    const response = await fetch(
      `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GH_PAT}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "webflow_publish",
          client_payload: {
            triggered_at: new Date().toISOString(),
            source: "webflow_webhook",
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${error}`);
    }

    console.log("✅ GitHub Actions workflow triggered successfully");
    return res.status(200).json({ success: true, message: "Sync triggered" });

  } catch (err) {
    console.error("❌ Failed to trigger workflow:", err.message);
    return res.status(500).json({ error: "Failed to trigger sync" });
  }
}
