import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { json, methodNotAllowed } from "../../lib/http.js";
import { syncVeganDirectoryAround } from "../../lib/services/veganDirectory.js";

/**
 * POST /api/directory/sync-vegan
 * HappyCowler-inspired vegan/vegetarian directory sync using OpenStreetMap
 * diet:* tags (HappyCow site is bot-protected; OSM is the legal free source).
 *
 * Body: { latitude, longitude, radiusMeters?, veganOnly? }
 */
const schema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(200).max(10000).optional().default(2500),
  veganOnly: z.boolean().optional().default(false),
});

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST", "OPTIONS"]);

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return json(res, 400, {
      error: "validation_error",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await syncVeganDirectoryAround(parsed.data);
    return json(res, 200, {
      status: "ok",
      message:
        "Synced vegan/vegetarian venues from OpenStreetMap Overpass into MongoDB Atlas (HappyCowler-style directory without scraping HappyCow).",
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync_failed";
    return json(res, 500, { error: "sync_failed", message });
  }
}
