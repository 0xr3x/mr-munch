import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getWebhookInfo, setWebhook } from "../../apps/telegram-bot/src/telegramApi.js";
import { json, methodNotAllowed } from "../../lib/http.js";

/**
 * POST /api/telegram/setup
 * Registers the Telegram webhook to this deployment.
 * Protect with TELEGRAM_SETUP_SECRET or BOOTSTRAP_SECRET when set.
 */
export const config = { maxDuration: 15 };

function publicBaseUrl(): string {
  if (process.env.MRMUNCH_PUBLIC_URL) {
    return process.env.MRMUNCH_PUBLIC_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "https://mrmunch.vercel.app";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "POST" && req.method !== "GET") {
    return methodNotAllowed(res, ["GET", "POST", "OPTIONS"]);
  }

  const expected =
    process.env.TELEGRAM_SETUP_SECRET ?? process.env.BOOTSTRAP_SECRET;
  if (expected) {
    const got =
      (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") ||
      (req.query.secret as string | undefined);
    if (got !== expected) {
      return json(res, 401, { error: "unauthorized" });
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return json(res, 503, { error: "telegram_not_configured" });
  }

  const webhookUrl = `${publicBaseUrl()}/api/telegram/webhook`;

  if (req.method === "GET") {
    const info = await getWebhookInfo();
    return json(res, 200, { webhookUrl, info });
  }

  await setWebhook(webhookUrl, process.env.TELEGRAM_WEBHOOK_SECRET);
  const info = await getWebhookInfo();
  return json(res, 200, { ok: true, webhookUrl, info });
}
