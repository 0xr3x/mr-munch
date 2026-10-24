import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleTelegramUpdate } from "../../apps/telegram-bot/src/handler.js";
import type { TelegramUpdate } from "../../apps/telegram-bot/src/telegramApi.js";
import { json, methodNotAllowed } from "../../lib/http.js";

/**
 * POST /api/telegram/webhook
 * Telegram sends updates here (setWebhook → this URL).
 * https://core.telegram.org/bots/api#setwebhook
 */
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return json(res, 204, null);
  if (req.method !== "POST") return methodNotAllowed(res, ["POST", "OPTIONS"]);

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers["x-telegram-bot-api-secret-token"];
    if (header !== secret) {
      return json(res, 401, { error: "unauthorized" });
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return json(res, 503, { error: "telegram_not_configured" });
  }

  try {
    const update = req.body as TelegramUpdate;
    // Acknowledge quickly path: process inline (recommend + TTS needs the 60s budget)
    await handleTelegramUpdate(update);
    return json(res, 200, { ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "webhook_error";
    // Still 200 so Telegram does not retry aggressively with bad payloads
    console.error("telegram_webhook", message.slice(0, 200));
    return json(res, 200, { ok: false });
  }
}
