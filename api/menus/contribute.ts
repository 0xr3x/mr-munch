import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { normalizeAllergenList } from "../../lib/allergens/lexicon.js";
import { contributeMenuFromPhoto } from "../../lib/db/contributeMenu.js";
import { json, methodNotAllowed } from "../../lib/http.js";
import { isMongoConfigured } from "../../lib/services/mongodb.js";
import { isOpenAiConfigured } from "../../lib/services/openaiVision.js";

/**
 * POST /api/menus/contribute
 * User uploads a menu / specials-board photo to update a restaurant's shared menu.
 *
 * Body:
 * - restaurantName (required)
 * - restaurantId (optional Google place id — preferred)
 * - imageUrl or imageBase64 (required)
 * - latitude / longitude (optional, used if restaurant is new)
 * - notes, contributorAnonymousId (optional)
 * - allergens / preferences (optional — annotate suitability in response)
 */
const contributeSchema = z.object({
  restaurantId: z.string().min(1).optional(),
  restaurantName: z.string().trim().min(1).max(200),
  imageUrl: z.string().url().optional(),
  imageBase64: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  notes: z.string().max(2000).optional(),
  contributorAnonymousId: z.string().max(128).optional(),
  allergens: z
    .array(
      z.enum([
        "celery",
        "cereals_containing_gluten",
        "crustaceans",
        "eggs",
        "fish",
        "lupin",
        "milk",
        "molluscs",
        "mustard",
        "tree_nuts",
        "nuts",
        "peanuts",
        "sesame",
        "soya",
        "sulphur_dioxide",
      ])
    )
    .optional()
    .default([])
    .transform((a) => normalizeAllergenList(a)),
  preferences: z
    .array(
      z.enum([
        "vegan",
        "vegetarian",
        "pescatarian",
        "halal",
        "kosher",
        "coeliac",
        "dairy_free",
        "gluten_free",
        "nut_free",
        "shellfish_free",
      ])
    )
    .optional()
    .default([]),
});

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST", "OPTIONS"]);

  const parsed = contributeSchema.safeParse(req.body);
  if (!parsed.success) {
    return json(res, 400, {
      error: "validation_error",
      message: "Invalid menu contribution",
      details: parsed.error.flatten(),
    });
  }

  if (!parsed.data.imageUrl && !parsed.data.imageBase64) {
    return json(res, 400, {
      error: "validation_error",
      message: "Provide imageUrl or imageBase64 of the menu / specials board",
    });
  }

  if (!isMongoConfigured()) {
    return json(res, 503, {
      error: "mongo_not_configured",
      message: "Menu updates require MONGODB_URI so contributions can update shared restaurant knowledge.",
    });
  }

  if (!isOpenAiConfigured()) {
    return json(res, 503, {
      error: "openai_not_configured",
      message: "OPENAI_API_KEY is required to read menu photos.",
    });
  }

  try {
    const result = await contributeMenuFromPhoto(parsed.data);
    const http = result.dishesUpserted > 0 ? 200 : 202;

    return json(res, http, {
      status: result.status,
      mode: "live",
      message: result.message,
      contribution: {
        id: result.contributionId,
        restaurantPlaceId: result.restaurantPlaceId,
        restaurantName: result.restaurantName,
        dishesParsed: result.dishesParsed,
        dishesUpserted: result.dishesUpserted,
        imageUrl: parsed.data.imageUrl ?? null,
      },
      menuPreview: {
        items: result.dishes.slice(0, 20).map((d) => ({
          name: d.name,
          description: d.description,
          priceGbp: d.priceGbp ?? null,
          allergensPresent: d.allergensPresent,
          suitable: d.suitable,
          preferenceConflicts: d.preferenceConflicts,
        })),
      },
      nextSteps: {
        message:
          "Dishes are in Atlas (source: user_contribution). /api/recommend hybrid search will use them for future diners.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "contribute_failed";
    return json(res, 500, { error: "contribute_failed", message });
  }
}
