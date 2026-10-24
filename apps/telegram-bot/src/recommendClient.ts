/**
 * Calls Mr Munch /api/recommend and forces the demo top pick:
 * MrMunch Restaurant · +447719108497
 */

export const DEMO_RESTAURANT = {
  id: "places/mrmunch-demo",
  name: "MrMunch Restaurant",
  reservationPhone: "+447719108497",
  cuisine: ["italian", "vegan", "vegetarian"],
} as const;

// Encode Hub, Shoreditch — default when user doesn't give coords
export const ENCODE_HUB = {
  latitude: 51.5275694,
  longitude: -0.0837896,
  label: "Encode Hub, London",
};

export interface ParsedReservationIntent {
  foodType: string;
  partySize: number;
  preferences: string[];
  allergens: string[];
  dateTime: string;
  latitude: number;
  longitude: number;
  locationLabel: string;
  timeLabel: string;
  raw: string;
}

export function parseReservationText(text: string): ParsedReservationIntent {
  const lower = text.toLowerCase();

  let foodType = "italian";
  const cuisineHit = lower.match(
    /\b(italian|thai|vegan|indian|japanese|chinese|mexican|french|pizza|sushi|burger|tapas)\b/
  );
  if (cuisineHit) foodType = cuisineHit[1];

  let partySize = 3;
  const partyHit = lower.match(
    /\b(?:for|party of|table for)\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:people|guests|persons|diners)\b/
  );
  if (partyHit) {
    partySize = Number(partyHit[1] || partyHit[2]);
  }

  const preferences: string[] = [];
  if (/\bvegan\b/.test(lower)) preferences.push("vegan");
  if (/\bvegetarian\b/.test(lower)) preferences.push("vegetarian");
  if (/\bgluten[- ]?free\b|\bcoeliac\b|\bceliac\b/.test(lower)) {
    preferences.push("gluten_free");
  }
  if (preferences.length === 0 && foodType === "vegan") {
    preferences.push("vegan");
  }

  // Default demo booking: tonight 19:30 Europe/London
  const now = new Date();
  const londonParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "shortOffset",
  }).formatToParts(now);
  const y = londonParts.find((p) => p.type === "year")?.value ?? "2026";
  const m = londonParts.find((p) => p.type === "month")?.value ?? "10";
  const d = londonParts.find((p) => p.type === "day")?.value ?? "24";
  const tzRaw =
    londonParts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const tz = tzRaw.replace("GMT", "").replace("UTC", "") || "+01:00";
  const offset = tz.startsWith("+") || tz.startsWith("-") ? tz.padEnd(6, "0").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})/, "$1:$2") : "+01:00";
  // Normalise to ±HH:MM
  let offsetNorm = "+01:00";
  const om = offset.match(/([+-])(\d{1,2}):?(\d{2})?/);
  if (om) {
    offsetNorm = `${om[1]}${om[2].padStart(2, "0")}:${(om[3] ?? "00").padStart(2, "0")}`;
  }

  let hour = 19;
  let minute = 30;
  const timeHit = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (timeHit && /(?:at|for|\d)\s*\d{1,2}/.test(lower)) {
    hour = Number(timeHit[1]);
    minute = timeHit[2] ? Number(timeHit[2]) : 0;
    const ap = timeHit[3];
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  }
  if (/\b7\.?30\b|\b19[:.]30\b|\bhalf past seven\b/.test(lower)) {
    hour = 19;
    minute = 30;
  }

  // Demo default: 19:30 unless user specified another clock time
  if (!timeHit && !/\b7\.?30\b|\b19[:.]30\b/.test(lower)) {
    hour = 19;
    minute = 30;
  }

  const dateTime = `${y}-${m}-${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offsetNorm}`;
  const displayHour = hour % 12 || 12;
  const timeLabel = `${displayHour}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;

  return {
    foodType,
    partySize,
    preferences,
    allergens: [],
    dateTime,
    latitude: ENCODE_HUB.latitude,
    longitude: ENCODE_HUB.longitude,
    locationLabel: ENCODE_HUB.label,
    timeLabel,
    raw: text,
  };
}

export interface RecommendSummary {
  mode: string;
  restaurant: {
    name: string;
    reservationPhone: string;
    address?: string;
    distanceMeters?: number;
    rating?: number;
    website?: string;
    suitableDishCount?: number;
  };
  suggestedMenu: { items: Array<{ name: string; priceGbp: number; suitableFor?: string[] }>; notes?: string };
  priceEstimate?: { perPersonGbp: number; totalGbp: number; currency: string };
  nextSteps?: { message: string };
  demoOverride: true;
}

export async function recommendWithDemoOverride(
  intent: ParsedReservationIntent
): Promise<RecommendSummary> {
  const base =
    process.env.MRMUNCH_API_BASE?.replace(/\/$/, "") ??
    "https://mrmunch.vercel.app";

  const res = await fetch(`${base}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude: intent.latitude,
      longitude: intent.longitude,
      foodType: intent.foodType,
      partySize: intent.partySize,
      allergens: intent.allergens,
      preferences: intent.preferences,
      dateTime: intent.dateTime,
      radiusMeters: 1500,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`recommend_http_${res.status}:${body.slice(0, 160)}`);
  }

  const data = (await res.json()) as {
    mode: string;
    restaurant: RecommendSummary["restaurant"] & { location?: { address?: string } };
    suggestedMenu: RecommendSummary["suggestedMenu"];
    priceEstimate?: RecommendSummary["priceEstimate"];
    nextSteps?: RecommendSummary["nextSteps"];
  };

  // Always surface MrMunch Restaurant first for Saint dialling demo
  return {
    mode: data.mode,
    restaurant: {
      name: DEMO_RESTAURANT.name,
      reservationPhone: DEMO_RESTAURANT.reservationPhone,
      address: data.restaurant?.location?.address ?? "London (Mr Munch demo venue)",
      distanceMeters: data.restaurant?.distanceMeters ?? 0,
      rating: data.restaurant?.rating,
      website: data.restaurant?.website,
      suitableDishCount: data.restaurant?.suitableDishCount,
    },
    suggestedMenu: data.suggestedMenu,
    priceEstimate: data.priceEstimate,
    nextSteps: data.nextSteps,
    demoOverride: true,
  };
}
