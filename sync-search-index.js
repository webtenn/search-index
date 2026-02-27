/**
 * Webflow Search Index Sync Script
 *
 * Fetches all content from 6 Webflow collections, resolves references
 * (Authors, Resource Types, Use Cases, Industries), and writes a unified
 * search-index.json file, then uploads it to GitHub via the API.
 *
 * Required environment variables:
 *   WEBFLOW_API_TOKEN  — Site API token (CMS read)
 *   WEBFLOW_SITE_ID    — Your Webflow Site ID
 *   GH_PAT             — GitHub Personal Access Token (repo scope)
 *   GH_OWNER           — GitHub username or org
 *   GH_REPO            — GitHub repo name
 */

const fs = require("fs");
const path = require("path");

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const SITE_ID   = process.env.WEBFLOW_SITE_ID;
const BASE_URL  = "https://api.webflow.com/v2";

const COLLECTION_IDS = {
  blogs:         "658f221d560869e694a6072e",
  caseStudies:   "658f221d560869e694a60732",
  whitepapers:   "658f221d560869e694a60735",
  webinars:      "658f221d560869e694a60736",
  dataSheets:    "658f221d560869e694a60734",
  pressReleases: "658f221d560869e694a60731",
};

const REFERENCE_COLLECTION_IDS = {
  authors:       "658f221d560869e694a6072f",
  resourceTypes: "658f221d560869e694a60730",
  useCases:      "658f221d560869e694a6072d",
  industries:    "658f221d560869e694a6072c",
};

const COLLECTION_URL_PREFIX = {
  blogs:         "/blog",
  caseStudies:   "/case-studies",
  whitepapers:   "/whitepapers",
  webinars:      "/webinars",
  dataSheets:    "/data-sheets",
  pressReleases: "/press-release",
};

const OUTPUT_PATH = path.join(__dirname, "search-index.json");

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const headers = {
  Authorization: `Bearer ${API_TOKEN}`,
  "accept-version": "1.0.0",
};

async function fetchAllItems(collectionId) {
  let items = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${BASE_URL}/collections/${collectionId}/items/live?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to fetch collection ${collectionId}: ${res.status} ${error}`);
    }

    const data = await res.json();
    const page = data.items || [];
    items = items.concat(page);

    if (page.length < limit) break;
    offset += limit;
  }

  return items;
}

async function buildLookupMap(collectionId, nameField = "name", extraFields = []) {
  const items = await fetchAllItems(collectionId);
  const map = {};

  for (const item of items) {
    const entry = { name: item.fieldData?.[nameField] || "" };
    for (const field of extraFields) {
      entry[field] = item.fieldData?.[field] || null;
    }
    map[item.id] = entry;
  }

  return map;
}

function resolveRef(id, map) {
  return map[id]?.name || null;
}

function resolveRefs(ids, map) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => resolveRef(id, map)).filter(Boolean);
}

// ─── GITHUB UPLOAD ────────────────────────────────────────────────────────────

async function uploadToGitHub(content, token, owner, repo) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/search-index.json`;
  const encoded = Buffer.from(content).toString("base64");

  // Get current file SHA if it exists (required for updates)
  let sha = null;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (res.ok) {
      const data = await res.json();
      sha = data.sha || null;
      console.log(`  Current file SHA: ${sha}`);
    } else {
      console.log(`  File does not exist yet, will create it`);
    }
  } catch (e) {
    console.log(`  Could not fetch existing SHA: ${e.message}`);
  }

  const body = {
    message: `chore: update search index [${new Date().toISOString()}]`,
    content: encoded,
  };

  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API upload failed: ${res.status} ${err}`);
  }

  console.log(`✅ search-index.json successfully uploaded to GitHub`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_TOKEN) throw new Error("Missing WEBFLOW_API_TOKEN environment variable");
  if (!SITE_ID)   throw new Error("Missing WEBFLOW_SITE_ID environment variable");

  console.log("🔄 Building reference lookup maps...");

  const [authorsMap, resourceTypesMap, useCasesMap, industriesMap] = await Promise.all([
    buildLookupMap(REFERENCE_COLLECTION_IDS.authors, "name", ["photo"]),
    buildLookupMap(REFERENCE_COLLECTION_IDS.resourceTypes, "name"),
    buildLookupMap(REFERENCE_COLLECTION_IDS.useCases, "name"),
    buildLookupMap(REFERENCE_COLLECTION_IDS.industries, "name"),
  ]);

  console.log(`  ✓ Authors: ${Object.keys(authorsMap).length}`);
  console.log(`  ✓ Resource Types: ${Object.keys(resourceTypesMap).length}`);
  console.log(`  ✓ Use Cases: ${Object.keys(useCasesMap).length}`);
  console.log(`  ✓ Industries: ${Object.keys(industriesMap).length}`);

  const allItems = [];

  for (const [collectionKey, collectionId] of Object.entries(COLLECTION_IDS)) {
    console.log(`\n📦 Fetching ${collectionKey}...`);
    const items = await fetchAllItems(collectionId);
    console.log(`  ✓ ${items.length} items found`);

    for (const item of items) {
      const f = item.fieldData || {};

      const authorId = f["author"] || null;
      const author = authorId
        ? {
            name:  authorsMap[authorId]?.name  || null,
            photo: authorsMap[authorId]?.photo || null,
          }
        : null;

      // Blogs use "resource-types", all others use "resource-type"
      const resourceTypeId = f["resource-types"] || f["resource-type"] || null;
      const resourceType = resourceTypeId ? resolveRef(resourceTypeId, resourceTypesMap) : null;

      const useCaseIds = Array.isArray(f["use-cases"]) ? f["use-cases"] : [];
      const useCases = resolveRefs(useCaseIds, useCasesMap);

      const industryIds = Array.isArray(f["industries"]) ? f["industries"] : [];
      const industries = resolveRefs(industryIds, industriesMap);

      allItems.push({
        id:            item.id,
        collection:    collectionKey,
        resourceType:  resourceType,
        title:         f["name"] || f["title"] || "",
        slug:          f["slug"] || "",
        url:           `${COLLECTION_URL_PREFIX[collectionKey]}/${f["slug"] || ""}`,
        excerpt:       f["excerpt"] || f["post-summary"] || f["description"] || "",
        thumbnail:     f["image"]?.url || f["thumbnail"]?.url || f["featured-image"]?.url || null,
        publishedDate: f["publish-date"] || f["published-date"] || f["date"] || null,
        author:        author,
        useCases:      useCases,
        industries:    industries,
      });
    }
  }

  // ── Write JSON file ──────────────────────────────────────────────────────
  const output = {
    lastUpdated: new Date().toISOString(),
    totalItems:  allItems.length,
    items:       allItems,
  };

  const jsonContent = JSON.stringify(output, null, 2);
  fs.writeFileSync(OUTPUT_PATH, jsonContent);

  console.log(`\n✅ Done! ${allItems.length} total items written to search-index.json`);
  console.log(`   Last updated: ${output.lastUpdated}`);

  // ── Upload to GitHub ─────────────────────────────────────────────────────
  const GH_PAT   = process.env.GH_PAT;
  const GH_OWNER = process.env.GH_OWNER;
  const GH_REPO  = process.env.GH_REPO;

  console.log(`\n📤 GitHub upload vars — owner: ${GH_OWNER}, repo: ${GH_REPO}, token: ${GH_PAT ? "set" : "MISSING"}`);

  if (GH_PAT && GH_OWNER && GH_REPO) {
    await uploadToGitHub(jsonContent, GH_PAT, GH_OWNER, GH_REPO);
  } else {
    console.log(`⚠️  Skipping upload — one or more GitHub env vars are missing`);
  }
}

main().catch((err) => {
  console.error("❌ Sync failed:", err.message);
  process.exit(1);
});
