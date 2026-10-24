# Mr Munch (monorepo)

AI dining concierge for people with dietary restrictions.

| Path | Package |
|------|---------|
| `api/` + `lib/` | Recommend / menus / Atlas API (Vercel) |
| `apps/telegram-bot/` | **SaintMrMunchbot** — Telegram agent + OpenAI TTS reservation voice |

Production: https://mrmunch.vercel.app · Bot: [@SaintMrMunchbot](https://t.me/SaintMrMunchbot)

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Service status + integration flags |
| `POST` | `/api/recommend` | Recommend a restaurant + menu + price |
| `POST` | `/api/menus/contribute` | Update a restaurant menu from a photo (OpenAI vision → Atlas) |
| `GET` | `/api/menus/:restaurantId` | Shared Atlas menu for a restaurant |
| `POST` | `/api/telegram/webhook` | Telegram updates for SaintMrMunchbot |
| `GET/POST` | `/api/telegram/setup` | Register Telegram webhook |

### SaintMrMunchbot

1. `/start` — greets and asks for the reservation  
2. Free-text request → calls `/api/recommend`  
3. Top pick is always **MrMunch Restaurant** · `+447719108497` (demo dial target)  
4. Sends a female OpenAI TTS voice asking to hold a table for **3 at 7:30 PM**  

See [`apps/telegram-bot/README.md`](./apps/telegram-bot/README.md).

## Recommend request (`POST /api/recommend`)

```json
{
  "latitude": 51.5074,
  "longitude": -0.1278,
  "foodType": "vegan",
  "partySize": 3,
  "allergens": ["tree_nuts", "peanuts", "crustaceans"],
  "preferences": ["vegan", "gluten_free"],
  "dateTime": "2026-10-24T19:30:00+01:00",
  "radiusMeters": 2000
}
```

| Field | Type | Notes |
|-------|------|--------|
| `latitude` / `longitude` | number | WGS84 |
| `foodType` | string | Cuisine / style |
| `partySize` | int 1–40 | Number of diners |
| `allergens` | string[] | UK's 14 major allergens (optional) |
| `preferences` | string[] | e.g. `vegan`, `coeliac` (optional) |
| `dateTime` | string | ISO 8601 **with timezone** |
| `radiusMeters` | int | Optional, default `2000` |

### Response (shape)

- `restaurant` — name, location (lat/lng + address), `reservationPhone`
- `suggestedMenu` — dishes checked against allergens/preferences
- `priceEstimate` — per person + total GBP
- `nextSteps` — Saint booking handoff (always requires user confirmation)

## Postman

1. Method: **POST**
2. URL: `https://<your-deployment>.vercel.app/api/recommend`
3. Headers: `Content-Type: application/json`
4. Body → raw → JSON → paste the sample above

Or import [`postman/MrMunch.postman_collection.json`](./postman/MrMunch.postman_collection.json).

## Local

```bash
npm install
cp .env.example .env
npm run dev
```

Then: `POST http://localhost:3000/api/recommend`

## Env

See `.env.example`.

When `GOOGLE_MAPS_API_KEY` is set (Places API **New**), `/api/recommend` runs in **live** mode:

1. Nearby restaurants from Google (incl. `website` + photos when available)
2. Website menus fetched via Jina Reader (`WEB_READER_BASE`)
3. Dishes checked against UK 14 allergens + preferences
4. Best restaurant ranked by suitable dish count

Optional: set `OPENAI_API_KEY` for stronger text/vision menu parsing (specials boards / photos).

### MongoDB Atlas setup (connection string, not “API key”)

Atlas apps use a **database user + connection string** (`MONGODB_URI`). Organization **API Keys** are only for the Atlas Admin API (automation), not for reading/writing your data.

1. Open [cloud.mongodb.com](https://cloud.mongodb.com) → create **Project** `mrmunch`
2. **Create cluster** (M0 free to start; M10+ if Automated Embedding requires it)
3. **Database Access** → Add Database User (password)
4. **Network Access** → allow `0.0.0.0/0` (or lock down later)
5. **Connect → Drivers** → copy `mongodb+srv://...` URI
6. `vercel env add MONGODB_URI` + `MONGODB_DB=mrmunch` → redeploy
7. `POST https://mrmunch.vercel.app/api/atlas/bootstrap` — creates indexes for:
   - Atlas Search (full-text)
   - Vector Search + **Automated Embedding** (`voyage-4` on `dishes.searchText`)
   - Hybrid `$rankFusion` + Voyage **`$rerank`**
8. Optional Stream Processing: `atlas/stream-processing/menu_contribution_pipeline.json`

### Dietary cross-check (Google → OSM → Atlas)

1. Google Places finds restaurants  
2. OpenStreetMap Overpass verifies `diet:vegan` / `diet:vegetarian`  
3. Flags stored on restaurant docs as `diet` and returned on `/api/recommend`  

For vegan/vegetarian parties, `POST /api/directory/sync-vegan` also seeds an OSM-based directory into Atlas (HappyCowler-style offline map data, without scraping HappyCow — their ToS/bot wall blocks that).

## Deploy

```bash
npm run deploy
```
