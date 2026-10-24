/**
 * User menu photo → OpenAI vision → upsert dishes into shared Atlas knowledge.
 */

import { annotateDishes, type ParsedDish } from "../menu/parseMenu.js";
import {
  dishesCol,
  isMongoConfigured,
  menuContributionsCol,
  restaurantsCol,
} from "../services/mongodb.js";
import {
  isOpenAiConfigured,
  recogniseMenuFromImage,
  type MenuVisionDish,
} from "../services/openaiVision.js";
import type { DietaryPreference, UkAllergen } from "../types.js";
import type { RestaurantDoc } from "./types.js";

export interface ContributeMenuInput {
  restaurantId?: string;
  restaurantName: string;
  imageUrl?: string;
  imageBase64?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  contributorAnonymousId?: string;
  allergens?: UkAllergen[];
  preferences?: DietaryPreference[];
}

export interface ContributeMenuResult {
  contributionId: string;
  status: "parsed" | "accepted_unparsed" | "stored_without_vision";
  restaurantPlaceId: string;
  restaurantName: string;
  dishesParsed: number;
  dishesUpserted: number;
  dishes: ParsedDish[];
  imageStored: boolean;
  message: string;
}

async function resolveRestaurant(
  input: ContributeMenuInput
): Promise<{
  placeId: string;
  name: string;
  location: RestaurantDoc["location"];
  cuisine: string[];
  existed: boolean;
}> {
  const restaurants = await restaurantsCol();
  const now = new Date();

  if (input.restaurantId) {
    const existing = await restaurants.findOne({ placeId: input.restaurantId });
    if (existing) {
      return {
        placeId: existing.placeId,
        name: existing.name,
        location: existing.location,
        cuisine: existing.cuisine ?? [],
        existed: true,
      };
    }
  }

  const byName = await restaurants.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(input.restaurantName)}$`, "i") },
  });
  if (byName) {
    return {
      placeId: byName.placeId,
      name: byName.name,
      location: byName.location,
      cuisine: byName.cuisine ?? [],
      existed: true,
    };
  }

  // Create a lightweight restaurant stub so contributions still enrich Atlas
  const placeId =
    input.restaurantId ??
    `contrib_${slugify(input.restaurantName)}_${Date.now()}`;
  const lat = input.latitude ?? 51.5275865;
  const lng = input.longitude ?? -0.0837702;
  const location: RestaurantDoc["location"] = {
    type: "Point",
    coordinates: [lng, lat],
  };

  await restaurants.updateOne(
    { placeId },
    {
      $set: {
        placeId,
        name: input.restaurantName,
        address: "User-contributed (address pending)",
        location,
        cuisine: [],
        allergenConfidence: "menu_inferred",
        updatedAt: now,
        sources: ["user_menu_photo"],
        ...(input.imageUrl ? { photoUrls: [input.imageUrl] } : {}),
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return {
    placeId,
    name: input.restaurantName,
    location,
    cuisine: [],
    existed: false,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

function visionToParsed(
  dishes: MenuVisionDish[],
  allergens: UkAllergen[],
  preferences: DietaryPreference[]
): ParsedDish[] {
  return annotateDishes(
    dishes.map((d) => {
      const allergenHint = (d.allergensSuspected ?? []).join(" ");
      return {
        name: d.name,
        description: d.description ?? "",
        priceGbp: d.priceGbp,
        raw: `${d.name}. ${d.description ?? ""} ${allergenHint}`.trim(),
        allergensPresent: [],
        allergenChecks: [],
        suitable: true,
        suitableFor: [],
        preferenceConflicts: [],
      };
    }),
    allergens,
    preferences
  );
}

async function upsertContributionDishes(
  restaurant: {
    placeId: string;
    name: string;
    location: RestaurantDoc["location"];
    cuisine: string[];
  },
  dishes: ParsedDish[],
  preferences: DietaryPreference[]
): Promise<number> {
  const col = await dishesCol();
  const now = new Date();
  let n = 0;

  for (const d of dishes) {
    const searchText = [
      d.name,
      d.description,
      restaurant.name,
      ...restaurant.cuisine,
      ...d.allergensPresent,
      "user contributed menu photo",
    ]
      .filter(Boolean)
      .join(" · ");

    const suitableFor =
      d.suitable && preferences.length
        ? preferences.filter((p) => !d.preferenceConflicts.includes(p))
        : [];

    await col.updateOne(
      { restaurantPlaceId: restaurant.placeId, name: d.name },
      {
        $set: {
          restaurantPlaceId: restaurant.placeId,
          restaurantName: restaurant.name,
          name: d.name,
          description: d.description,
          searchText,
          priceGbp: d.priceGbp,
          allergensPresent: d.allergensPresent,
          suitableFor,
          location: restaurant.location,
          cuisine: restaurant.cuisine,
          source: "user_contribution",
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

export async function contributeMenuFromPhoto(
  input: ContributeMenuInput
): Promise<ContributeMenuResult> {
  if (!isMongoConfigured()) {
    throw new Error("MONGODB_URI is not set");
  }

  const contributionId = `contrib_${Date.now()}`;
  const allergens = input.allergens ?? [];
  const preferences = input.preferences ?? [];
  const image = input.imageUrl ?? input.imageBase64;
  if (!image) throw new Error("imageUrl or imageBase64 required");

  const restaurant = await resolveRestaurant(input);
  let dishes: ParsedDish[] = [];
  let status: ContributeMenuResult["status"] = "stored_without_vision";
  let visionError: string | undefined;

  if (isOpenAiConfigured()) {
    try {
      const vision = await recogniseMenuFromImage(image);
      dishes = visionToParsed(vision.dishes, allergens, preferences);
      status = dishes.length > 0 ? "parsed" : "accepted_unparsed";
    } catch (err) {
      visionError = err instanceof Error ? err.message : "vision_failed";
      status = "accepted_unparsed";
    }
  } else {
    status = "accepted_unparsed";
  }

  const dishesUpserted =
    dishes.length > 0
      ? await upsertContributionDishes(restaurant, dishes, preferences)
      : 0;

  const restaurants = await restaurantsCol();
  await restaurants.updateOne(
    { placeId: restaurant.placeId },
    {
      $set: {
        allergenConfidence:
          dishesUpserted > 0 ? "menu_inferred" : "needs_restaurant_check",
        updatedAt: new Date(),
      },
      $addToSet: {
        sources: "user_menu_photo",
        ...(input.imageUrl ? { photoUrls: input.imageUrl } : {}),
      },
    }
  );

  const contributions = await menuContributionsCol();
  await contributions.insertOne({
    contributionId,
    restaurantPlaceId: restaurant.placeId,
    restaurantName: restaurant.name,
    restaurantExisted: restaurant.existed,
    imageUrl: input.imageUrl ?? null,
    hasImageBase64: Boolean(input.imageBase64),
    notes: input.notes,
    contributorAnonymousId: input.contributorAnonymousId,
    dishes: dishes.map((d) => ({
      name: d.name,
      description: d.description,
      priceGbp: d.priceGbp,
      allergensPresent: d.allergensPresent,
      suitable: d.suitable,
    })),
    dishesUpserted,
    status,
    visionError,
    createdAt: new Date(),
  });

  return {
    contributionId,
    status,
    restaurantPlaceId: restaurant.placeId,
    restaurantName: restaurant.name,
    dishesParsed: dishes.length,
    dishesUpserted,
    dishes,
    imageStored: Boolean(input.imageUrl),
    message:
      dishesUpserted > 0
        ? `Parsed ${dishes.length} dishes from photo and updated Atlas menu for ${restaurant.name}. Hybrid/vector search will pick these up as embeddings refresh.`
        : visionError
          ? `Stored contribution but vision failed (${visionError}).`
          : !isOpenAiConfigured()
            ? "Stored contribution. Enable OPENAI_API_KEY to parse menu photos into dishes."
            : "Stored contribution, but no dishes could be read from this image. Try a clearer menu / specials-board photo.",
  };
}
