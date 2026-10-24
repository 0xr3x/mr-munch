import type { VercelRequest, VercelResponse } from "@vercel/node";
import { json, methodNotAllowed } from "../lib/http.js";
import { recommend } from "../lib/recommend.js";
import { recommendRequestSchema } from "../lib/validation.js";

/** Allow time for Places + website menu fetches */
export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return json(res, 204, null);
  }
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST", "OPTIONS"]);
  }

  const parsed = recommendRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return json(res, 400, {
      error: "validation_error",
      message: "Invalid recommend request",
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await recommend(parsed.data);
    return json(res, 200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    return json(res, 500, {
      error: "recommend_failed",
      message,
    });
  }
}
