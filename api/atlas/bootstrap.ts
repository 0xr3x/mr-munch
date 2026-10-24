import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, methodNotAllowed } from "../../lib/http.js";
import {
  ensureDataIndexes,
  getDb,
  isMongoConfigured,
} from "../../lib/services/mongodb.js";

const SEARCH_INDEXES = [
  {
    collection: "dishes",
    name: "dishes_vector_search",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "autoEmbed",
          modality: "text",
          path: "searchText",
          model: "voyage-4",
        },
        { type: "filter", path: "allergensPresent" },
        { type: "filter", path: "restaurantPlaceId" },
        { type: "filter", path: "suitableFor" },
      ],
    },
  },
  {
    collection: "dishes",
    name: "dishes_full_text_search",
    type: "search",
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          searchText: { type: "string", analyzer: "lucene.standard" },
          name: { type: "string", analyzer: "lucene.standard" },
          description: { type: "string", analyzer: "lucene.standard" },
          restaurantName: { type: "string", analyzer: "lucene.standard" },
          cuisine: { type: "string", analyzer: "lucene.standard" },
          allergensPresent: { type: "string" },
          suitableFor: { type: "string" },
          location: { type: "geo" },
        },
      },
    },
  },
  {
    collection: "restaurants",
    name: "restaurants_full_text_search",
    type: "search",
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          name: { type: "string", analyzer: "lucene.standard" },
          cuisine: { type: "string", analyzer: "lucene.standard" },
          address: { type: "string", analyzer: "lucene.standard" },
          location: { type: "geo" },
        },
      },
    },
  },
] as const;

/**
 * POST /api/atlas/bootstrap
 * Creates data indexes + Atlas Search / Vector Search (Voyage autoEmbed) indexes.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST", "OPTIONS"]);

  if (!isMongoConfigured()) {
    return json(res, 503, {
      error: "mongo_not_configured",
      message:
        "Set MONGODB_URI on Vercel. You need a connection string, not an Atlas Admin API key.",
      setup: {
        atlasUrl: "https://cloud.mongodb.com",
        steps: [
          "Create Organization → New Project → name it mrmunch",
          "Create cluster (start with M0 Free; upgrade to M10+ if autoEmbed requires it)",
          "Database Access → Add NEW Database User (password) — this is what the app uses",
          "Network Access → Allow 0.0.0.0/0 (or restrict later)",
          "Connect → Drivers → copy mongodb+srv://... URI (replace <password>)",
          "vercel env add MONGODB_URI production  (+ development)",
          "vercel env add MONGODB_DB production  value: mrmunch",
          "Redeploy, then POST /api/atlas/bootstrap again",
          "Note: Organization → Access Manager → API Keys are for Atlas Admin API only (optional)",
        ],
      },
    });
  }

  const secret = process.env.BOOTSTRAP_SECRET;
  if (secret && req.headers["x-bootstrap-secret"] !== secret) {
    return json(res, 401, { error: "unauthorized" });
  }

  try {
    const dataIndexes = await ensureDataIndexes();
    const db = await getDb();
    const searchIndexResults: Array<{ name: string; ok: boolean; detail?: string }> =
      [];

    for (const spec of SEARCH_INDEXES) {
      try {
        const coll = db.collection(spec.collection);
        await coll.createSearchIndex({
          name: spec.name,
          type: spec.type,
          definition: spec.definition,
        });
        searchIndexResults.push({ name: spec.name, ok: true });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        // Already exists is fine
        const ok = /already exists|duplicate/i.test(detail);
        searchIndexResults.push({
          name: spec.name,
          ok,
          detail: ok ? "already_exists" : detail,
        });
      }
    }

    return json(res, 200, {
      status: "ok",
      database: process.env.MONGODB_DB ?? "mrmunch",
      dataIndexes,
      searchIndexes: searchIndexResults,
      featuresWired: [
        "Atlas Search (full-text on dishes + restaurants)",
        "Vector Search + Automated Embedding (Voyage voyage-4 on dishes.searchText)",
        "Hybrid Search ($rankFusion vector + text)",
        "Voyage AI reranking ($rerank rerank-2.5)",
        "Stream Processing recipe in atlas/stream-processing/ (optional)",
      ],
      next: [
        "Atlas → Search Indexes → wait until Ready",
        "Call POST /api/recommend to scrape + store dishes (embeddings generate async)",
        "Later queries reuse Atlas hybrid search (faster, shared knowledge)",
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "bootstrap_failed";
    return json(res, 500, { error: "bootstrap_failed", message });
  }
}
