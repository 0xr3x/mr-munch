import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, methodNotAllowed } from "../lib/http.js";
import { getRuntimeMode } from "../lib/recommend.js";
import { isGoogleMapsConfigured } from "../lib/services/googleMaps.js";
import { isMongoConfigured } from "../lib/services/mongodb.js";
import { isOpenAiConfigured } from "../lib/services/openaiVision.js";
import { isOsmConfigured } from "../lib/services/openStreetMap.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return json(res, 204, null);
  }
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET", "OPTIONS"]);
  }

  return json(res, 200, {
    service: "mrmunch-api",
    status: "ok",
    mode: getRuntimeMode(),
    integrations: {
      mongodb: isMongoConfigured(),
      googleMaps: isGoogleMapsConfigured(),
      openStreetMap: isOsmConfigured(),
      openaiVision: isOpenAiConfigured(),
    },
    endpoints: {
      recommend: "POST /api/recommend",
      contributeMenu: "POST /api/menus/contribute",
      getRestaurantMenu: "GET /api/menus/:restaurantId",
      syncVeganDirectory: "POST /api/directory/sync-vegan",
      atlasBootstrap: "POST /api/atlas/bootstrap",
      atlasPing: "GET /api/atlas/ping",
      health: "GET /api/health",
    },
  });
}
