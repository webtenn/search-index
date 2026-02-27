/**
 * Webflow Search Index Sync Script
 * 
 * Fetches all content from 6 Webflow collections, resolves references
 * (Authors, Resource Types, Use Cases, Industries), and writes a unified
 * search-index.json file to the repo.
 * 
 * Required environment variables:
 *   WEBFLOW_API_TOKEN  — Site API token (CMS read)
 *   WEBFLOW_SITE_ID    — Your Webflow Site ID
 */

const fs = require("fs");
const path = require("path");

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const SITE_ID = process.env.WEBFLOW_SITE_ID;
const BASE_URL = "https://api.webflow.com/v2";

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

// URL prefix for each collection — maps to existing Webflow URL structure
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

/**
 * Fetch all items from a collection, handling pagination automatically.
 * Webflow v2 API returns max 100 items per page.
 */
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

    // If we got fewer items than the limit, we've reached the last page
    if (page.length < limit) break;
    offset += limit;
  }

  return items;
}

/**
 * Build a lookup map from a reference collection: { itemId -> name }
 * Optionally also captures a secondary field (e.g. photo for Authors).
 */
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

/**
 * Resolve a single reference ID to a name using a lookup map.
 */
function resolveRef(id, map) {
  return map[id]?.name || null;
}

/**
 * Resolve an array of reference IDs to an array of names.
 */
function resolveRefs(ids, map) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => resolveRef(id, map)).filter(Boolean);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!API_TOKEN) throw new Error("Missing WEBFLOW_API_TOKEN environment variable");
  if (!SITE_ID)   throw new Error("Missing WEBFLOW_SITE_ID environment variable");

  console.log("🔄 Building reference lookup maps...");

  // Fetch all reference collections in parallel
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

  // ── Process each content collection ────────────────────────────────────────
  for (const [collectionKey, collectionId] of Object.entries(COLLECTION_IDS)) {
    console.log(`\n📦 Fetching ${collectionKey}...`);
    const items = await fetchAllItems(collectionId);
    console.log(`  ✓ ${items.length} items found`);

    for (const item of items) {
      const f = item.fieldData || {};

      // Resolve author reference
      const authorId = f["author"] || null;
      const author = authorId
        ? {
            name:  authorsMap[authorId]?.name  || null,
            photo: authorsMap[authorId]?.photo || null,
          }
        : null;

      // Resolve resource type (single reference)
      // Blogs use "resource-types", Case Studies use "resource-type"
      const resourceTypeId = f["resource-types"] || f["resource-type"] || null;
      const resourceType = resourceTypeId ? resolveRef(resourceTypeId, resourceTypesMap) : null;

      // Resolve use cases (multi-reference — array of IDs)
      // Webflow field slug: "use-cases" (can be null if not filled in)
      const useCaseIds = Array.isArray(f["use-cases"]) ? f["use-cases"] : [];
      const useCases = resolveRefs(useCaseIds, useCasesMap);

      // Resolve industries (multi-reference — array of IDs)
      // Webflow field slug: "industries" (can be null if not filled in)
      const industryIds = Array.isArray(f["industries"]) ? f["industries"] : [];
      const industries = resolveRefs(industryIds, industriesMap);

      // Build the unified item
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

  // ── Write output ────────────────────────────────────────────────────────────
  const output = {
    lastUpdated: new Date().toISOString(),
    totalItems: allItems.length,
    items: allItems,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✅ Done! ${allItems.length} total items written to search-index.json`);
  console.log(`   Last updated: ${output.lastUpdated}`);
}

main().catch((err) => {
  console.error("❌ Sync failed:", err.message);
  process.exit(1);
});
