/** Ephemeral per-chat state (fine for demo; cold starts reset). */

export type ChatPhase = "greeted" | "awaiting_details" | "done";

export interface ChatSession {
  phase: ChatPhase;
  firstName?: string;
}

const sessions = new Map<number, ChatSession>();

export function getSession(chatId: number): ChatSession {
  let s = sessions.get(chatId);
  if (!s) {
    s = { phase: "awaiting_details" };
    sessions.set(chatId, s);
  }
  return s;
}

export function resetSession(chatId: number, firstName?: string): ChatSession {
  const s: ChatSession = { phase: "awaiting_details", firstName };
  sessions.set(chatId, s);
  return s;
}
