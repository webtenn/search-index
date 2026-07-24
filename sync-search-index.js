/**
 * Webflow Search Index Sync Script
 *
 * Fetches all content from the Webflow content collections, resolves references
 * (Authors, Resource Types, Use Cases, Industries), builds the Use Case Group
 * taxonomy (parent -> children, from the Use Case Groups collection + the Group
 * field on Use Cases), and writes a unified search-index.json file, then uploads
 * it to GitHub via the API.
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
  pressReleases: "658f221d560869e694a60731",
  events:        "6627de4d0ed5d6d4e1b1b693",
  research:      "6a3c2e068f1328eafb5da97c",
  podcast:       "6a590ff2d6ddc4d1b3dc4ae2",
};

const REFERENCE_COLLECTION_IDS = {
  authors:       "658f221d560869e694a6072f",
  resourceTypes: "658f221d560869e694a60730",
  useCases:      "658f221d560869e694a6072d",
  industries:    "658f221d560869e694a6072c",
  useCaseGroups: "6a62321ff874bd2ca9cc7728",
};

// Desired display order of the Use Case Groups (the bold parent rows in the
// front-end filter). Groups found in Webflow but not listed here are appended
// alphabetically, so new groups still flow through automatically.
const USE_CASE_GROUP_ORDER = [
  "Frontier Alignment",
  "Agentic AI",
  "Speech & Audio",
  "Multimodal AI",
  "Physical AI",
  "Model Integrity",
  "Coding Repositories",
  "AI Research Services (ResearchOps)",
];

const COLLECTION_URL_PREFIX = {
  blogs:         "/blog",
  caseStudies:   "/case-studies",
  whitepapers:   "/whitepapers",
  webinars:      "/webinars",
  pressReleases: "/press-release",
  events:        "/events",
  research:      "/research",
  podcast:       "/podcasts",
};

// Resolve webinar-status option IDs to human-readable labels
// These are the option IDs from the Webflow dropdown field
const WEBINAR_STATUS_MAP = {
  "1de415a2a371f91235bca9e56bb347af": "On-Demand",
  "4bca6dc0e38a874af553ec9052c4eae7": "Live",
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

  if (sha) body.sha = sha;

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

  const [authorsMap, resourceTypesMap, useCasesMap, industriesMap, useCaseGroupsMap] = await Promise.all([
    buildLookupMap(REFERENCE_COLLECTION_IDS.authors, "name", ["photo"]),
    buildLookupMap(REFERENCE_COLLECTION_IDS.resourceTypes, "name"),
    buildLookupMap(REFERENCE_COLLECTION_IDS.useCases, "name", ["group"]),
    buildLookupMap(REFERENCE_COLLECTION_IDS.industries, "name"),
    buildLookupMap(REFERENCE_COLLECTION_IDS.useCaseGroups, "name"),
  ]);

  console.log(`  ✓ Authors: ${Object.keys(authorsMap).length}`);
  console.log(`  ✓ Resource Types: ${Object.keys(resourceTypesMap).length}`);
  console.log(`  ✓ Use Cases: ${Object.keys(useCasesMap).length}`);
  console.log(`  ✓ Industries: ${Object.keys(industriesMap).length}`);
  console.log(`  ✓ Use Case Groups: ${Object.keys(useCaseGroupsMap).length}`);

  // ── Build the Use Case Group taxonomy (parent → children) ────────────────
  // Each Use Case item carries a multi-reference "group" field pointing at the
  // Use Case Groups collection. Resolve those into an ordered parent→children
  // structure the front-end filter renders directly.
  const childrenByGroup = {};
  for (const uc of Object.values(useCasesMap)) {
    const groupIds = Array.isArray(uc.group) ? uc.group : [];
    for (const gid of groupIds) {
      const groupName = useCaseGroupsMap[gid]?.name;
      if (!groupName || !uc.name) continue;
      (childrenByGroup[groupName] = childrenByGroup[groupName] || new Set()).add(uc.name);
    }
  }

  const orderedGroupNames = USE_CASE_GROUP_ORDER.filter((n) => childrenByGroup[n])
    .concat(Object.keys(childrenByGroup).filter((n) => USE_CASE_GROUP_ORDER.indexOf(n) === -1).sort());

  const useCaseGroups = orderedGroupNames.map((name) => ({
    name,
    children: Array.from(childrenByGroup[name]).sort(),
  }));

  console.log(`  ✓ Use Case taxonomy: ${useCaseGroups.length} groups, ${useCaseGroups.reduce((s, g) => s + g.children.length, 0)} child use cases`);

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

      const industryIds = Array.isArray(f["industries"]) ? f["industries"] : Array.isArray(f["categories"]) ? f["categories"] : [];
      const industries = resolveRefs(industryIds, industriesMap);

      // Events-specific fields
      const isEvent = collectionKey === "events";
      const eventDateText = f["event-date-text"] || null;
      const eventBooth    = f["event-booth"] || null;
      const eventStatus   = f["webinar-status"] || null;
      const eventVenue    = f["event-venue"] || null;
      const eventLocation = f["event-location"] || null;

      allItems.push({
        id:            item.id,
        collection:    collectionKey,
        resourceType:  resourceType,
        title:         f["name"] || f["title"] || "",
        slug:          f["slug"] || "",
        url:           f["external-url"] || `${COLLECTION_URL_PREFIX[collectionKey]}/${f["slug"] || ""}`,
        excerpt:       f["excerpt"] || f["post-summary"] || f["description"] || "",
        thumbnail:     f["image"]?.url || f["thumbnail"]?.url || f["featured-image"]?.url || null,
        publishedDate: f["publish-date"] || f["published-date"] || f["date"] || null,
        author:        author,
        publisher:     f["publisher"] || null,
        useCases:      useCases,
        industries:    industries,
        // Event-specific fields (null for non-events)
        eventDateText: isEvent ? eventDateText : null,
        eventBooth:    isEvent ? eventBooth : null,
        eventStatus:   isEvent ? eventStatus : null,
        eventVenue:    isEvent ? eventVenue : null,
        eventLocation: isEvent ? eventLocation : null,
      });
    }
  }

  // ── Write JSON file ──────────────────────────────────────────────────────
  const output = {
    lastUpdated:   new Date().toISOString(),
    totalItems:    allItems.length,
    useCaseGroups: useCaseGroups,
    items:         allItems,
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
