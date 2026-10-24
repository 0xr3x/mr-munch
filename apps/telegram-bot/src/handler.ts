/**
 * SaintMrMunchbot update handler.
 * Greet → collect reservation → call Mr Munch API → demo top pick → TTS voice.
 */

import {
  parseReservationText,
  recommendWithDemoOverride,
  DEMO_RESTAURANT,
} from "./recommendClient.js";
import { getSession, resetSession } from "./sessions.js";
import {
  sendChatAction,
  sendMessage,
  sendVoice,
  type TelegramUpdate,
} from "./telegramApi.js";
import { synthesizeReservationVoice } from "./tts.js";

const HELP = `Tell me what you need in one message, for example:
• "Italian near Encode Hub tonight at 7:30 for 3, one vegan"
• "Thai for 2, vegetarian, Shoreditch"`;

function isStart(text: string): boolean {
  return /^\/start\b/i.test(text.trim()) || /^\/help\b/i.test(text.trim());
}

async function greet(chatId: number, firstName?: string): Promise<void> {
  resetSession(chatId, firstName);
  const name = firstName ? ` ${firstName}` : "";
  await sendMessage(
    chatId,
    `Hi${name} — I'm Saint, your Mr Munch dining concierge (SaintMrMunchbot).\n\n` +
      `I'll find a table that works for everyone, then dial the restaurant with a voice request.\n\n` +
      `What reservation do you need?\n\n${HELP}`
  );
}

function formatSuggestion(
  intent: ReturnType<typeof parseReservationText>,
  result: Awaited<ReturnType<typeof recommendWithDemoOverride>>
): string {
  const dishes = (result.suggestedMenu?.items ?? [])
    .slice(0, 4)
    .map((d) => `• ${d.name}${d.priceGbp ? ` (£${d.priceGbp})` : ""}`)
    .join("\n");

  const price = result.priceEstimate
    ? `≈ £${result.priceEstimate.totalGbp} for ${intent.partySize} (${result.priceEstimate.currency})`
    : "Price estimate unavailable";

  return [
    `Got it — searching near ${intent.locationLabel} for ${intent.foodType}, party of ${intent.partySize}` +
      (intent.preferences.length ? ` (${intent.preferences.join(", ")})` : "") +
      ` at ${intent.timeLabel}.`,
    ``,
    `Top pick (demo dial target):`,
    `🍽 ${DEMO_RESTAURANT.name}`,
    `📞 ${DEMO_RESTAURANT.reservationPhone}`,
    result.restaurant.address ? `📍 ${result.restaurant.address}` : "",
    price,
    dishes ? `\nMenu ideas:\n${dishes}` : "",
    ``,
    `I'll record a female voice message asking them to hold a table for ${intent.partySize} at 7:30 PM — sending it now.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const firstName = msg.from?.first_name;

  if (isStart(text)) {
    await greet(chatId, firstName);
    return;
  }

  const session = getSession(chatId);
  if (session.phase === "awaiting_details" || session.phase === "greeted") {
    await sendChatAction(chatId, "typing");
    await sendMessage(chatId, "On it — checking Mr Munch for options…");

    try {
      const intent = parseReservationText(text);
      // Demo booking time locked to 7:30 for the voice script
      intent.timeLabel = "7:30 PM";

      const result = await recommendWithDemoOverride(intent);
      await sendMessage(chatId, formatSuggestion(intent, result));

      await sendChatAction(chatId, "record_voice");
      const audio = await synthesizeReservationVoice({
        restaurantName: DEMO_RESTAURANT.name,
        restaurantPhone: DEMO_RESTAURANT.reservationPhone,
        partySize: intent.partySize || 3,
        timeLabel: "seven thirty",
      });

      await sendVoice(
        chatId,
        audio,
        "saint-reservation.mp3",
        `Voice request for ${DEMO_RESTAURANT.name} (${DEMO_RESTAURANT.reservationPhone}) — table for ${intent.partySize || 3} at 7:30 PM`
      );

      await sendMessage(
        chatId,
        `Voice ready. Shall I have a human dial ${DEMO_RESTAURANT.reservationPhone} to confirm?\n\n` +
          `Send another request anytime, or /start to begin again.`
      );
      session.phase = "done";
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_error";
      await sendMessage(
        chatId,
        `Something went wrong talking to Mr Munch (${message.slice(0, 120)}). Try again with a short request, or /start.`
      );
    }
    return;
  }

  await greet(chatId, firstName);
}
