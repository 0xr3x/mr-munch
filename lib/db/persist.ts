import type { MenuDiscoveryResult } from "../services/menuDiscovery.js";
import type { GooglePlaceResult } from "../services/googleMaps.js";
import {
  dishesCol,
  isMongoConfigured,
  restaurantsCol,
} from "../services/mongodb.js";
import type { DietaryPreference } from "../types.js";
import type { RestaurantDoc } from "./types.js";

function point(lng: number, lat: number): RestaurantDoc["location"] {
  return { type: "Point", coordinates: [lng, lat] };
}

export async function upsertRestaurantFromPlace(
  place: GooglePlaceResult & { photoUrls?: string[]; websiteUri?: string },
  extra: {
    allergenConfidence: RestaurantDoc["allergenConfidence"];
    sources: string[];
    cuisine?: string[];
    diet?: RestaurantDoc["diet"];
  }
): Promise<void> {
  if (!isMongoConfigured()) return;
  const col = await restaurantsCol();
  const now = new Date();
  await col.updateOne(
    { placeId: place.id },
    {
      $set: {
        placeId: place.id,
        name: place.name,
        address: place.address,
        location: point(place.longitude, place.latitude),
        phone: place.phone,
        website: place.websiteUri,
        photoUrls: place.photoUrls,
        cuisine: extra.cuisine ?? place.types?.slice(0, 6) ?? [],
        rating: place.rating,
        allergenConfidence: extra.allergenConfidence,
        updatedAt: now,
        sources: extra.sources,
        ...(extra.diet ? { diet: extra.diet } : {}),
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

export async function upsertDishesFromDiscovery(
  place: GooglePlaceResult,
  menu: MenuDiscoveryResult,
  opts: { cuisine?: string[]; preferences?: DietaryPreference[] } = {}
): Promise<number> {
  if (!isMongoConfigured() || menu.dishes.length === 0) return 0;
  const col = await dishesCol();
  const now = new Date();
  const cuisine = opts.cuisine ?? [];
  let n = 0;

  for (const d of menu.dishes) {
    const searchText = [
      d.name,
      d.description,
      place.name,
      ...cuisine,
      ...d.allergensPresent,
    ]
      .filter(Boolean)
      .join(" · ");

    const suitableFor =
      d.suitable && opts.preferences?.length
        ? opts.preferences.filter((p) => !d.preferenceConflicts.includes(p))
        : [];

    await col.updateOne(
      { restaurantPlaceId: place.id, name: d.name },
      {
        $set: {
          restaurantPlaceId: place.id,
          restaurantName: place.name,
          name: d.name,
          description: d.description,
          searchText,
          priceGbp: d.priceGbp,
          allergensPresent: d.allergensPresent,
          suitableFor,
          location: point(place.longitude, place.latitude),
          cuisine,
          source: menu.sources.some((s) => s.includes("openai"))
            ? "openai_vision"
            : "website_scrape",
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
    n++;
  }
  return n;
}
