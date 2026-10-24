import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, methodNotAllowed } from "../../lib/http.js";
import { dishesCol, getDb, isMongoConfigured } from "../../lib/services/mongodb.js";

/** GET /api/atlas/ping — verify Vercel → Atlas connectivity */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "GET") return methodNotAllowed(res, ["GET", "OPTIONS"]);

  if (!isMongoConfigured()) {
    return json(res, 503, { ok: false, error: "MONGODB_URI not set" });
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    const dishes = await dishesCol();
    const dishCount = await dishes.countDocuments();
    return json(res, 200, {
      ok: true,
      database: process.env.MONGODB_DB ?? "mrmunch",
      dishCount,
      restaurantHint:
        "If this fails with TLS/SSL from Vercel, set Atlas Network Access to allow 0.0.0.0/0",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(res, 500, {
      ok: false,
      error: message,
      hint: "Atlas → Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)",
    });
  }
}
