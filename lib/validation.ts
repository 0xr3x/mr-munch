import { z } from "zod";
import { normalizeAllergenList } from "./allergens/lexicon.js";

const ukAllergens = [
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
  "peanuts",
  "sesame",
  "soya",
  "sulphur_dioxide",
  // legacy alias → normalized to tree_nuts
  "nuts",
] as const;

const preferences = [
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
] as const;

export const recommendRequestSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    foodType: z.string().trim().min(1).max(80),
    partySize: z.number().int().min(1).max(40),
    allergens: z.array(z.enum(ukAllergens)).optional().default([]),
    preferences: z.array(z.enum(preferences)).optional().default([]),
    dateTime: z
      .string()
      .datetime({ offset: true, message: "dateTime must be ISO 8601 with timezone" }),
    radiusMeters: z.number().int().min(100).max(20000).optional().default(2000),
  })
  .transform((data) => ({
    ...data,
    allergens: normalizeAllergenList(data.allergens),
  }));

export type ParsedRecommendRequest = z.infer<typeof recommendRequestSchema>;
