/**
 * Thin Telegram Bot API client.
 * Docs: https://core.telegram.org/bots/api
 */

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${botToken()}/${method}`;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  date: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

async function callApi<T>(
  method: string,
  body: Record<string, unknown> | FormData
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; description?: string; result?: T };
  if (!data.ok) {
    throw new Error(data.description ?? `telegram_${method}_failed`);
  }
  return data.result as T;
}

export async function sendMessage(
  chatId: number,
  text: string,
  extra?: { reply_markup?: unknown; parse_mode?: "HTML" | "Markdown" }
): Promise<void> {
  await callApi("sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

export async function sendChatAction(
  chatId: number,
  action: "typing" | "record_voice" | "upload_voice"
): Promise<void> {
  await callApi("sendChatAction", { chat_id: chatId, action });
}

/** sendVoice — OGG preferred; MP3 often works via sendAudio fallback. */
export async function sendVoice(
  chatId: number,
  oggOrMp3: Buffer,
  filename: string,
  caption?: string
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  const bytes = new Uint8Array(oggOrMp3);
  form.append("voice", new Blob([bytes], { type: "audio/mpeg" }), filename);
  try {
    await callApi("sendVoice", form);
  } catch {
    const form2 = new FormData();
    form2.append("chat_id", String(chatId));
    if (caption) form2.append("caption", caption);
    form2.append("audio", new Blob([bytes], { type: "audio/mpeg" }), filename);
    await callApi("sendAudio", form2);
  }
}

export async function setWebhook(url: string, secretToken?: string): Promise<void> {
  await callApi("setWebhook", {
    url,
    allowed_updates: ["message"],
    drop_pending_updates: true,
    ...(secretToken ? { secret_token: secretToken } : {}),
  });
}

export async function getWebhookInfo(): Promise<unknown> {
  return callApi("getWebhookInfo", {});
}
