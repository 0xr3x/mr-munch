import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, methodNotAllowed } from "../../lib/http.js";
import {
  dishesCol,
  isMongoConfigured,
  restaurantsCol,
} from "../../lib/services/mongodb.js";

/**
 * GET /api/menus/:restaurantId
 * Return the shared Atlas menu for a restaurant (incl. user photo contributions).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "GET") return methodNotAllowed(res, ["GET", "OPTIONS"]);

  if (!isMongoConfigured()) {
    return json(res, 503, { error: "mongo_not_configured" });
  }

  const restaurantId = String(req.query.restaurantId ?? "");
  if (!restaurantId) {
    return json(res, 400, { error: "restaurantId_required" });
  }

  const restaurants = await restaurantsCol();
  const restaurant = await restaurants.findOne({ placeId: restaurantId });
  if (!restaurant) {
    return json(res, 404, { error: "restaurant_not_found", restaurantId });
  }

  const dishesCollection = await dishesCol();
  const dishes = await dishesCollection
    .find({ restaurantPlaceId: restaurantId })
    .project({
      name: 1,
      description: 1,
      priceGbp: 1,
      allergensPresent: 1,
      suitableFor: 1,
      source: 1,
      updatedAt: 1,
    })
    .sort({ name: 1 })
    .limit(200)
    .toArray();

  return json(res, 200, {
    restaurant: {
      placeId: restaurant.placeId,
      name: restaurant.name,
      address: restaurant.address,
      phone: restaurant.phone,
      website: restaurant.website,
      photoUrls: restaurant.photoUrls ?? [],
      allergenConfidence: restaurant.allergenConfidence,
    },
    dishes,
    dishCount: dishes.length,
  });
}
