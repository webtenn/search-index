# Search Index Sync

Fetches content from 6 Webflow CMS collections, resolves all references, and writes a unified `search-index.json` file used to power the site's multi-collection search page.

---

## Repository Structure

```
/
├── .github/
│   └── workflows/
│       └── sync-search-index.yml   # GitHub Actions workflow
├── sync-search-index.js            # Main sync script
├── webhook-handler.js              # Webflow webhook → GitHub trigger
├── search-index.json               # Output file (auto-generated, do not edit)
├── package.json
└── README.md
```

---

## Setup

### 1. GitHub Secrets

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add the following secrets:

| Secret Name | Value |
|---|---|
| `WEBFLOW_API_TOKEN` | Your Webflow site API token (CMS read) |
| `WEBFLOW_SITE_ID` | Your Webflow Site ID |
| `GH_PAT` | GitHub Personal Access Token with `repo` scope (needed to commit the JSON back to the repo) |
| `WEBHOOK_SECRET` | A secret string you create — must match what you set in Webflow's webhook config |

### 2. GitHub Personal Access Token (GH_PAT)

The workflow needs permission to commit the updated `search-index.json` back to the repo.

1. Go to GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Generate a new token with **repo** scope
3. Add it as the `GH_PAT` secret above

### 3. Deploy the Webhook Handler

The `webhook-handler.js` file needs to be deployed as a serverless function so Webflow has a URL to POST to.

**Option A — Vercel (recommended)**
1. Create a new Vercel project
2. Add `webhook-handler.js` to an `/api` folder
3. Add the following environment variables in Vercel:
   - `GH_PAT`
   - `GH_OWNER` (your GitHub username or org)
   - `GH_REPO` (this repo's name)
   - `WEBHOOK_SECRET` (same value as your GitHub secret)
4. Deploy — your webhook URL will be `https://your-project.vercel.app/api/webhook-handler`

**Option B — Cloudflare Workers**
Paste the handler code into a new Cloudflare Worker and set the same environment variables.

### 4. Configure Webflow Webhooks

In Webflow go to **Site Settings** → **Integrations** → **Webhooks** and add webhooks for:

- `collection_item_published` → your webhook URL
- `collection_item_unpublished` → your webhook URL

Add a custom header: `x-webhook-secret` → your `WEBHOOK_SECRET` value

---

## Running Manually

You can trigger the sync at any time from the GitHub Actions tab:

1. Go to **Actions** → **Sync Search Index**
2. Click **Run workflow**

Or locally (requires env vars):

```bash
WEBFLOW_API_TOKEN=your_token WEBFLOW_SITE_ID=your_site_id node sync-search-index.js
```

---

## Schedule

The workflow runs automatically every day at **2:00 AM UTC** as a full rebuild fallback, regardless of webhook activity.

---

## Output Format

The generated `search-index.json` has the following structure:

```json
{
  "lastUpdated": "2026-02-27T02:00:00Z",
  "totalItems": 500,
  "items": [
    {
      "id": "webflow-item-id",
      "collection": "blogs",
      "resourceType": "Blog",
      "title": "Article Title",
      "slug": "article-title",
      "url": "/blog/article-title",
      "excerpt": "Short description...",
      "thumbnail": "https://cdn.webflow.com/image.jpg",
      "publishedDate": "2026-01-15",
      "author": {
        "name": "Jane Smith",
        "photo": "https://cdn.webflow.com/photo.jpg"
      },
      "useCases": ["LLM & Gen AI", "Computer Vision"],
      "industries": ["Healthcare", "Finance"]
    }
  ]
}
```
