/**
 * Vegan / vegetarian directory enrichment (HappyCowler-inspired).
 *
 * HappyCowler scrapes HappyCow.net for offline vegan maps, but HappyCow is
 * bot-protected and the project itself warns crawling may be illegal.
 * We achieve the same goal legally via OpenStreetMap diet:* tags and store
 * results in MongoDB Atlas for hybrid search.
 */

import {
  dishesCol,
  isMongoConfigured,
  restaurantsCol,
} from "./mongodb.js";
import {
  searchOsmDietPlaces,
  type OsmDietPlace,
} from "./openStreetMap.js";

export interface VeganDirectorySyncResult {
  fetched: number;
  restaurantsUpserted: number;
  directoryDocsUpserted: number;
  places: Array<{
    name: string;
    vegan: string;
    vegetarian: string;
    osmId: string;
  }>;
  source: "openstreetmap_overpass";
}

function point(lng: number, lat: number) {
  return { type: "Point" as const, coordinates: [lng, lat] as [number, number] };
}

export async function syncVeganDirectoryAround(input: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  veganOnly?: boolean;
}): Promise<VeganDirectorySyncResult> {
  const places = await searchOsmDietPlaces({
    latitude: input.latitude,
    longitude: input.longitude,
    radiusMeters: input.radiusMeters ?? 2500,
    veganOnly: input.veganOnly,
  });

  if (!isMongoConfigured()) {
    return {
      fetched: places.length,
      restaurantsUpserted: 0,
      directoryDocsUpserted: 0,
      places: places.slice(0, 20).map((p) => ({
        name: p.name,
        vegan: p.vegan,
        vegetarian: p.vegetarian,
        osmId: p.osmId,
      })),
      source: "openstreetmap_overpass",
    };
  }

  const restaurants = await restaurantsCol();
  const dishes = await dishesCol();
  const now = new Date();
  let restaurantsUpserted = 0;
  let directoryDocsUpserted = 0;

  for (const p of places) {
    const placeId = `osm:${p.osmId}`;
    const suitableFor = [
      ...(p.vegan === "yes" || p.vegan === "only" || p.vegan === "limited"
        ? (["vegan"] as const)
        : []),
      ...(p.vegetarian === "yes" ||
      p.vegetarian === "only" ||
      p.vegetarian === "limited" ||
      p.vegan === "yes" ||
      p.vegan === "only"
        ? (["vegetarian"] as const)
        : []),
    ];

    await restaurants.updateOne(
      { placeId },
      {
        $set: {
          placeId,
          name: p.name,
          address: p.rawTags["addr:full"] ?? p.rawTags["addr:street"] ?? "OSM POI",
          location: point(p.longitude, p.latitude),
          phone: p.phone,
          website: p.website,
          cuisine: p.cuisine ? p.cuisine.split(";").map((c) => c.trim()) : [],
          allergenConfidence: "menu_inferred",
          diet: {
            vegan: p.vegan,
            vegetarian: p.vegetarian,
            osmId: p.osmId,
            verifiedAt: now,
            source: "openstreetmap",
          },
          updatedAt: now,
          sources: ["openstreetmap_overpass", "vegan_directory_sync"],
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    restaurantsUpserted++;

    // Lightweight directory "card" as a searchable dish-like doc for hybrid search
    const searchText = [
      p.name,
      "vegan directory",
      p.vegan !== "unknown" ? `diet:vegan=${p.vegan}` : "",
      p.vegetarian !== "unknown" ? `diet:vegetarian=${p.vegetarian}` : "",
      p.cuisine ?? "",
      p.amenity ?? "",
    ]
      .filter(Boolean)
      .join(" · ");

    await dishes.updateOne(
      { restaurantPlaceId: placeId, name: `${p.name} (OSM diet listing)` },
      {
        $set: {
          restaurantPlaceId: placeId,
          restaurantName: p.name,
          name: `${p.name} (OSM diet listing)`,
          description: `OpenStreetMap dietary listing. vegan=${p.vegan}, vegetarian=${p.vegetarian}`,
          searchText,
          allergensPresent: [],
          suitableFor: [...suitableFor],
          location: point(p.longitude, p.latitude),
          cuisine: p.cuisine ? p.cuisine.split(";") : [],
          source: "restaurant_confirmed",
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    directoryDocsUpserted++;
  }

  return {
    fetched: places.length,
    restaurantsUpserted,
    directoryDocsUpserted,
    places: places.slice(0, 40).map((p) => ({
      name: p.name,
      vegan: p.vegan,
      vegetarian: p.vegetarian,
      osmId: p.osmId,
    })),
    source: "openstreetmap_overpass",
  };
}

export function summarizeOsmMatch(place: OsmDietPlace): {
  vegan: string;
  vegetarian: string;
  osmId: string;
} {
  return {
    vegan: place.vegan,
    vegetarian: place.vegetarian,
    osmId: place.osmId,
  };
}

/** Load previously synced OSM diet venues from Atlas (fallback when Overpass is blocked). */
export async function loadOsmDietFromAtlas(input: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}): Promise<OsmDietPlace[]> {
  if (!isMongoConfigured()) return [];
  const restaurants = await restaurantsCol();
  const radius = input.radiusMeters ?? 2500;
  const docs = await restaurants
    .find({
      "diet.source": "openstreetmap",
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
    .limit(80)
    .toArray();

  return docs.map((d) => ({
    osmId: d.diet?.osmId ?? d.placeId.replace(/^osm:/, ""),
    name: d.name,
    latitude: d.location.coordinates[1],
    longitude: d.location.coordinates[0],
    vegan: (d.diet?.vegan ?? "unknown") as OsmDietPlace["vegan"],
    vegetarian: (d.diet?.vegetarian ?? "unknown") as OsmDietPlace["vegetarian"],
    cuisine: d.cuisine?.join(";"),
    phone: d.phone,
    website: d.website,
    rawTags: {},
  }));
}
