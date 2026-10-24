/**
 * Hybrid Search = Atlas Search (full-text) + Vector Search (Voyage autoEmbed)
 * fused with $rankFusion, optionally reordered with Voyage $rerank.
 */

import type { Document } from "mongodb";
import { dishesCol, isMongoConfigured } from "../services/mongodb.js";
import type { DietaryPreference, UkAllergen } from "../types.js";
import type { DishDoc } from "./types.js";

export interface HybridDishHit extends DishDoc {
  scoreDetails?: unknown;
  rerankScore?: number;
  vectorSearchScore?: number;
}

export interface HybridSearchInput {
  query: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  avoidAllergens?: UkAllergen[];
  preferences?: DietaryPreference[];
  limit?: number;
  /** Use Voyage $rerank after fusion (Atlas) */
  rerank?: boolean;
  /** Restrict results to these restaurants (e.g. grounding the final answer) */
  restaurantPlaceIds?: string[];
}

/** Voyage $rerank is on unless ATLAS_VOYAGE_RERANK=false (falls back silently if the cluster lacks it). */
export function isRerankEnabled(): boolean {
  return process.env.ATLAS_VOYAGE_RERANK !== "false";
}

function buildQueryText(input: HybridSearchInput): string {
  const prefs = (input.preferences ?? []).map((p) => p.replace(/_/g, " "));
  return [input.query, ...prefs].filter(Boolean).join(" ");
}

/**
 * Hybrid dish search. Falls back to geo + allergen filter if Search indexes
 * are not ready yet.
 */
export async function hybridSearchDishes(
  input: HybridSearchInput
): Promise<{ hits: HybridDishHit[]; method: string }> {
  if (!isMongoConfigured()) {
    return { hits: [], method: "mongo_not_configured" };
  }

  const col = await dishesCol();
  const limit = Math.min(input.limit ?? 20, 50);
  const q = buildQueryText(input);
  const avoid = input.avoidAllergens ?? [];

  const placeIds = input.restaurantPlaceIds ?? [];
  const vectorFilter: Document = {
    ...(avoid.length ? { allergensPresent: { $nin: avoid } } : {}),
    ...(placeIds.length ? { restaurantPlaceId: { $in: placeIds } } : {}),
  };

  const useRerank = input.rerank ?? isRerankEnabled();

  const fusionPipeline: Document[] = [
    {
      $rankFusion: {
        input: {
          pipelines: {
            vectorPipeline: [
              {
                $vectorSearch: {
                  index: "dishes_vector_search",
                  path: "searchText",
                  query: { text: q },
                  numCandidates: 200,
                  limit: 40,
                  ...(Object.keys(vectorFilter).length
                    ? { filter: vectorFilter }
                    : {}),
                },
              },
            ],
            fullTextPipeline: [
              {
                $search: {
                  index: "dishes_full_text_search",
                  compound: {
                    must: [
                      {
                        text: {
                          query: q,
                          path: [
                            "searchText",
                            "name",
                            "description",
                            "restaurantName",
                          ],
                          fuzzy: { maxEdits: 1 },
                        },
                      },
                    ],
                    ...(avoid.length
                      ? {
                          mustNot: avoid.map((a) => ({
                            equals: { path: "allergensPresent", value: a },
                          })),
                        }
                      : {}),
                    should: [
                      {
                        near: {
                          path: "location",
                          origin: {
                            type: "Point",
                            coordinates: [input.longitude, input.latitude],
                          },
                          pivot: input.radiusMeters ?? 2000,
                        },
                      },
                    ],
                  },
                },
              },
              // restaurantPlaceId isn't in the search index, so filter after $search
              ...(placeIds.length
                ? [{ $match: { restaurantPlaceId: { $in: placeIds } } }]
                : []),
              { $limit: 40 },
            ],
          },
        },
        combination: {
          weights: {
            vectorPipeline: 0.55,
            fullTextPipeline: 0.45,
          },
        },
        scoreDetails: true,
      },
    },
    {
      $addFields: {
        scoreDetails: { $meta: "scoreDetails" },
      },
    },
    { $limit: limit },
  ];

  try {
    if (useRerank) {
      try {
        const withRerank: Document[] = [
          ...fusionPipeline.slice(0, -1),
          {
            $rerank: {
              model: "rerank-2.5",
              query: { text: q },
              path: "searchText",
              numDocsToRerank: 40,
            },
          },
          { $addFields: { rerankScore: { $meta: "score" } } },
          { $limit: limit },
        ];
        const hits = (await col
          .aggregate(withRerank)
          .toArray()) as HybridDishHit[];
        return { hits, method: "hybrid_rankFusion_voyage_rerank" };
      } catch {
        /* $rerank not available on this cluster tier — continue without */
      }
    }

    const hits = (await col
      .aggregate(fusionPipeline)
      .toArray()) as HybridDishHit[];
    return { hits, method: "hybrid_rankFusion" };
  } catch (err) {
    // Indexes may not exist yet — fall back to classic query
    const message = err instanceof Error ? err.message : String(err);
    const radius = input.radiusMeters ?? 2500;
    const fallback = (await col
      .find({
        ...(avoid.length ? { allergensPresent: { $nin: avoid } } : {}),
        ...(placeIds.length ? { restaurantPlaceId: { $in: placeIds } } : {}),
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [input.longitude, input.latitude],
            },
            $maxDistance: radius,
          },
        },
      })
      .limit(limit)
      .toArray()) as HybridDishHit[];

    return {
      hits: fallback,
      method: `geo_fallback:${message.slice(0, 120)}`,
    };
  }
}

/** Group dish hits by restaurant for recommend ranking. */
export function groupHitsByRestaurant(hits: HybridDishHit[]): Map<
  string,
  { restaurantName: string; dishes: HybridDishHit[]; placeId: string }
> {
  const map = new Map<
    string,
    { restaurantName: string; dishes: HybridDishHit[]; placeId: string }
  >();
  for (const hit of hits) {
    const id = hit.restaurantPlaceId;
    const g = map.get(id) ?? {
      restaurantName: hit.restaurantName,
      dishes: [],
      placeId: id,
    };
    g.dishes.push(hit);
    map.set(id, g);
  }
  return map;
}
