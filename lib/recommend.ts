import { groupHitsByRestaurant, hybridSearchDishes } from "./db/hybridSearch.js";
import {
  upsertDishesFromDiscovery,
  upsertRestaurantFromPlace,
} from "./db/persist.js";
import { buildProvisionalMenu } from "./menu/provisional.js";
import { buildMockRecommendation } from "./mock/restaurants.js";
import { generateGroundedAnswer } from "./services/groundedAnswer.js";
import { isOpenAiConfigured } from "./services/openaiVision.js";
import type {
  GroundedAnswer,
  RecommendRequest,
  RecommendResponse,
  RestaurantOption,
} from "./types.js";
import {
  getPlaceDetails,
  isGoogleMapsConfigured,
  resolvePhotoUrls,
  searchNearbyRestaurants,
  toRestaurantOption,
  type GooglePlaceResult,
} from "./services/googleMaps.js";
import { discoverMenuForPlace } from "./services/menuDiscovery.js";
import { isMongoConfigured } from "./services/mongodb.js";
import {
  isOsmConfigured,
  matchGoogleToOsm,
  osmSupportsPreference,
  searchOsmDietPlaces,
  type OsmDietPlace,
} from "./services/openStreetMap.js";
import {
  loadOsmDietFromAtlas,
  syncVeganDirectoryAround,
} from "./services/veganDirectory.js";

/** Skip the grounded answer if the request is already close to Vercel's 60 s limit */
const GROUNDED_ANSWER_BUDGET_MS = 45_000;

export function getRuntimeMode(): "mock" | "live" {
  if (isGoogleMapsConfigured()) return "live";
  const mode = (process.env.MRMUNCH_MODE ?? "mock").toLowerCase();
  return mode === "live" ? "live" : "mock";
}

function scorePlace(
  rating: number | undefined,
  distanceMeters: number,
  userRatingCount: number | undefined
): number {
  const r = rating ?? 3.5;
  const reviews = userRatingCount ?? 0;
  const reviewBoost = Math.min(Math.log10(reviews + 1) * 3, 12);
  const distancePenalty = distanceMeters / 200;
  return r * 10 + reviewBoost - distancePenalty;
}

function wantsPlantBased(prefs: string[] | undefined): boolean {
  return Boolean(
    prefs?.some((p) => p === "vegan" || p === "vegetarian")
  );
}

async function enrichPlace(
  place: GooglePlaceResult,
  origin: { lat: number; lng: number }
): Promise<GooglePlaceResult & { photoUrls: string[] }> {
  const details = await getPlaceDetails(place.id, origin);
  if (details) {
    return {
      ...place,
      ...details,
      websiteUri: details.websiteUri ?? place.websiteUri,
      photoUrls: details.photoUrls,
    };
  }
  const photoUrls = await resolvePhotoUrls(place.photoNames, 3);
  return { ...place, photoUrls };
}

function withDiet(
  option: RestaurantOption,
  osm: OsmDietPlace | undefined,
  match?: { distanceMeters?: number; nameScore?: number }
): RestaurantOption {
  if (!osm) return option;
  return {
    ...option,
    diet: {
      vegan: osm.vegan,
      vegetarian: osm.vegetarian,
      osmId: osm.osmId,
      source: "openstreetmap",
      matchDistanceMeters: match?.distanceMeters,
      nameScore: match?.nameScore,
    },
  };
}

async function recommendFromGoogle(
  req: RecommendRequest
): Promise<RecommendResponse> {
  const startedAt = Date.now();
  const sources: string[] = ["google_places_api"];
  const prefs = req.preferences ?? [];

  // 1) Atlas hybrid search
  let atlasBoost = new Map<
    string,
    { restaurantName: string; dishCount: number; sampleNames: string[] }
  >();
  if (isMongoConfigured()) {
    const { hits, method } = await hybridSearchDishes({
      query: req.foodType,
      latitude: req.latitude,
      longitude: req.longitude,
      radiusMeters: req.radiusMeters ?? 2000,
      avoidAllergens: req.allergens,
      preferences: prefs,
      limit: 30,
    });
    sources.push(`atlas:${method}`);
    const grouped = groupHitsByRestaurant(hits);
    for (const [placeId, g] of grouped) {
      atlasBoost.set(placeId, {
        restaurantName: g.restaurantName,
        dishCount: g.dishes.length,
        sampleNames: g.dishes.slice(0, 3).map((d) => d.name),
      });
    }
  }

  // 2) Google Places nearby
  const places = await searchNearbyRestaurants({
    latitude: req.latitude,
    longitude: req.longitude,
    radiusMeters: req.radiusMeters ?? 2000,
    keyword: req.foodType,
    preferences: prefs,
    maxResults: 12,
  });

  // 3) OSM diet:* cross-check (+ seed vegan directory when plant-based)
  let osmPlaces: OsmDietPlace[] = [];
  if (isOsmConfigured()) {
    try {
      osmPlaces = await searchOsmDietPlaces({
        latitude: req.latitude,
        longitude: req.longitude,
        radiusMeters: req.radiusMeters ?? 2000,
        veganOnly: prefs.includes("vegan"),
      });
      sources.push(`openstreetmap_diet:${osmPlaces.length}`);

      if (wantsPlantBased(prefs) && isMongoConfigured()) {
        // HappyCowler-style directory populate from OSM (legal alternative to HappyCow scrape)
        const sync = await syncVeganDirectoryAround({
          latitude: req.latitude,
          longitude: req.longitude,
          radiusMeters: req.radiusMeters ?? 2000,
          veganOnly: prefs.includes("vegan"),
        });
        sources.push(
          `vegan_directory_sync:${sync.restaurantsUpserted}/${sync.fetched}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "osm_error";
      sources.push(`openstreetmap_error:${message.slice(0, 80)}`);
      if (isMongoConfigured()) {
        osmPlaces = await loadOsmDietFromAtlas({
          latitude: req.latitude,
          longitude: req.longitude,
          radiusMeters: req.radiusMeters ?? 2000,
        });
        sources.push(`openstreetmap_atlas_fallback:${osmPlaces.length}`);
      }
    }
  }

  if (places.length === 0) {
    const mock = buildMockRecommendation(req);
    return {
      ...mock,
      mode: "mock",
      meta: {
        ...mock.meta,
        sources: [...mock.meta.sources, "google_places_empty_fallback", ...sources],
      },
    };
  }

  const ranked = [...places].sort((a, b) => {
    const atlasA = atlasBoost.get(a.id)?.dishCount ?? 0;
    const atlasB = atlasBoost.get(b.id)?.dishCount ?? 0;
    const osmA = matchGoogleToOsm(a, osmPlaces);
    const osmB = matchGoogleToOsm(b, osmPlaces);
    let dietBoostA = 0;
    let dietBoostB = 0;
    if (osmA.matched && osmA.place) {
      const s = osmSupportsPreference(osmA.place, prefs);
      dietBoostA = s.ok
        ? osmA.place.vegan === "only"
          ? 55
          : osmA.place.vegan === "yes"
            ? 35
            : 25
        : -40;
    }
    if (osmB.matched && osmB.place) {
      const s = osmSupportsPreference(osmB.place, prefs);
      dietBoostB = s.ok
        ? osmB.place.vegan === "only"
          ? 55
          : osmB.place.vegan === "yes"
            ? 35
            : 25
        : -40;
    }
    const scoreA =
      scorePlace(a.rating, a.distanceMeters, a.userRatingCount) +
      atlasA * 20 +
      dietBoostA;
    const scoreB =
      scorePlace(b.rating, b.distanceMeters, b.userRatingCount) +
      atlasB * 20 +
      dietBoostB;
    return scoreB - scoreA;
  });

  const candidates = ranked.slice(0, 4);
  const origin = { lat: req.latitude, lng: req.longitude };

  const analysed = await Promise.all(
    candidates.map(async (place) => {
      const enriched = await enrichPlace(place, origin);
      const osmMatch = matchGoogleToOsm(enriched, osmPlaces);
      const menu = await discoverMenuForPlace(enriched, {
        partySize: req.partySize,
        allergens: req.allergens ?? [],
        preferences: prefs,
      });

      if (isMongoConfigured()) {
        try {
          await upsertRestaurantFromPlace(enriched, {
            allergenConfidence: menu.allergenConfidence,
            sources: [
              ...menu.sources,
              ...(osmMatch.matched ? ["openstreetmap_diet_match"] : []),
            ],
            diet: osmMatch.place
              ? {
                  vegan: osmMatch.place.vegan,
                  vegetarian: osmMatch.place.vegetarian,
                  osmId: osmMatch.place.osmId,
                  verifiedAt: new Date(),
                  source: "openstreetmap",
                  matchDistanceMeters: osmMatch.distanceMeters,
                  nameScore: osmMatch.nameScore,
                }
              : undefined,
          });
          const stored = await upsertDishesFromDiscovery(enriched, menu, {
            preferences: prefs,
          });
          if (stored > 0) sources.push(`mongo_upsert:${place.id}:${stored}`);
        } catch {
          sources.push(`mongo_upsert_failed:${place.id}`);
        }
      }

      let osmBonus = 0;
      if (osmMatch.matched && osmMatch.place) {
        const s = osmSupportsPreference(osmMatch.place, prefs);
        osmBonus = s.ok
          ? osmMatch.place.vegan === "only"
            ? 60
            : osmMatch.place.vegan === "yes"
              ? 40
              : 30
          : -50;
        sources.push(
          `osm_match:${place.name.slice(0, 24)}:${s.reason}`
        );
      }

      const atlasBonus = (atlasBoost.get(place.id)?.dishCount ?? 0) * 12;
      const dietaryScore =
        menu.suitableCount * 15 +
        (menu.totalParsed > 0 ? 10 : 0) +
        atlasBonus +
        osmBonus +
        scorePlace(
          enriched.rating,
          enriched.distanceMeters,
          enriched.userRatingCount
        );
      return { place: enriched, menu, dietaryScore, osmMatch };
    })
  );

  analysed.sort((a, b) => b.dietaryScore - a.dietaryScore);
  const best = analysed[0];
  const { place: bestPlace, menu, osmMatch } = best;

  const restaurant = withDiet(
    {
      ...toRestaurantOption(bestPlace, menu.allergenConfidence),
      website: menu.website ?? bestPlace.websiteUri,
      photoUrls:
        menu.photoUrls.length > 0 ? menu.photoUrls : bestPlace.photoUrls,
      suitableDishCount: menu.suitableCount,
      menuPagesFetched: menu.pagesFetched,
    },
    osmMatch.place,
    osmMatch
  );

  const alternatives = analysed.slice(1, 4).map(({ place, menu: m, osmMatch: om }) =>
    withDiet(
      {
        ...toRestaurantOption(place, m.allergenConfidence),
        website: m.website ?? place.websiteUri,
        photoUrls: m.photoUrls,
        suitableDishCount: m.suitableCount,
        menuPagesFetched: m.pagesFetched,
      },
      om.place,
      om
    )
  );

  const useScrapedMenu = menu.totalParsed > 0;
  const provisional = buildProvisionalMenu(req);

  const phoneNote =
    bestPlace.phone != null
      ? bestPlace.phone
      : "the number on Google Maps (not listed in Places response)";

  const atlasNote = atlasBoost.get(bestPlace.id);
  const dietNote = restaurant.diet
    ? ` OSM diet: vegan=${restaurant.diet.vegan}, vegetarian=${restaurant.diet.vegetarian}.`
    : "";

  // 6) RAG: retrieve this restaurant's dishes from Atlas (hybrid + rerank) and
  //    let the LLM write the recommendation from them only
  let groundedAnswer: GroundedAnswer | undefined;
  if (isOpenAiConfigured() && Date.now() - startedAt < GROUNDED_ANSWER_BUDGET_MS) {
    try {
      const retrieved = isMongoConfigured()
        ? await hybridSearchDishes({
            query: req.foodType,
            latitude: req.latitude,
            longitude: req.longitude,
            radiusMeters: req.radiusMeters ?? 2000,
            avoidAllergens: req.allergens,
            preferences: prefs,
            restaurantPlaceIds: [bestPlace.id],
            limit: 12,
          })
        : { hits: [], method: "mongo_not_configured" };
      // Dishes upserted in this run may not be embedded yet; fall back to them
      const fromAtlas = retrieved.hits.length > 0;
      const dishes = fromAtlas
        ? retrieved.hits.map((h) => ({
            name: h.name,
            description: h.description,
            allergensPresent: h.allergensPresent,
            source: h.source,
          }))
        : menu.dishes.slice(0, 15).map((d) => ({
            name: d.name,
            description: d.description,
            allergensPresent: d.allergensPresent,
          }));

      if (dishes.length > 0) {
        groundedAnswer = await generateGroundedAnswer({
          restaurant: {
            name: restaurant.name,
            distanceMeters: restaurant.distanceMeters,
            allergenConfidence: restaurant.allergenConfidence,
            osmVegan: restaurant.diet?.vegan,
          },
          party: {
            partySize: req.partySize,
            foodType: req.foodType,
            allergens: req.allergens ?? [],
            preferences: prefs,
          },
          dishes,
          retrieval: {
            source: fromAtlas ? "atlas_hybrid_search" : "fresh_menu_scrape",
            method: retrieved.method,
            dishesRetrieved: dishes.length,
          },
        });
        sources.push(
          `grounded_answer:${fromAtlas ? `atlas:${retrieved.method}` : "fresh_menu_scrape"}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "grounded_answer_error";
      sources.push(`grounded_answer_failed:${message.slice(0, 80)}`);
    }
  }

  return {
    mode: "live",
    requestEcho: req,
    restaurant,
    suggestedMenu: useScrapedMenu ? menu.suggestedMenu : provisional.suggestedMenu,
    priceEstimate: useScrapedMenu ? menu.priceEstimate : provisional.priceEstimate,
    alternatives,
    groundedAnswer,
    nextSteps: {
      requiresUserConfirmation: true,
      bookingChannel: bestPlace.phone ? "saint_agent" : "phone",
      message: useScrapedMenu
        ? `Found ${restaurant.name} (~${restaurant.distanceMeters}m). Menu: ${menu.suitableCount}/${menu.totalParsed} suitable.${atlasNote ? ` Atlas knew ${atlasNote.dishCount} dishes.` : ""}${dietNote} Ready for Saint to call ${phoneNote}.`
        : `Found ${restaurant.name}.${dietNote} Confirm allergens before booking.`,
    },
    menuAnalysis: {
      dishesParsed: menu.totalParsed,
      suitableDishes: menu.suitableCount,
      pagesFetched: menu.pagesFetched,
      photoUrls: menu.photoUrls,
      method: menu.sources,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      sources: [
        ...new Set([
          ...sources,
          ...(useScrapedMenu ? ["website_menu_scrape"] : ["provisional_menu"]),
          ...menu.sources.slice(0, 4),
          ...(isMongoConfigured() ? ["mongodb_atlas"] : []),
        ]),
      ],
    },
  };
}

export async function recommend(
  req: RecommendRequest
): Promise<RecommendResponse> {
  if (isGoogleMapsConfigured()) {
    try {
      return await recommendFromGoogle(req);
    } catch (err) {
      const mock = buildMockRecommendation(req);
      const message = err instanceof Error ? err.message : "google_places_error";
      return {
        ...mock,
        mode: "mock",
        meta: {
          ...mock.meta,
          sources: [...mock.meta.sources, `google_places_error:${message}`],
        },
      };
    }
  }

  return buildMockRecommendation(req);
}
