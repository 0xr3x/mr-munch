# SaintMrMunchbot

Telegram agent for Mr Munch. Greets the user, takes a reservation request, calls `/api/recommend`, always surfaces **MrMunch Restaurant** (`+447719108497`) as the dial target, then sends a **female OpenAI TTS** voice message asking to hold a table for **3 at 7:30 PM**.

## Flow

1. `/start` → greeting + ask for reservation details  
2. User free-text (e.g. Italian near Encode Hub, 3 people, one vegan)  
3. `POST /api/recommend` (live Places / Atlas)  
4. Override top pick → MrMunch Restaurant  
5. OpenAI `audio/speech` (`nova`) → `sendVoice` / `sendAudio`

## Endpoints (Vercel)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/telegram/webhook` | Telegram updates |
| `GET/POST` | `/api/telegram/setup` | Register webhook |

Docs: [Telegram Bot API](https://core.telegram.org/bots/api)

## Env

See root `.env.example` — `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `MRMUNCH_PUBLIC_URL`.
