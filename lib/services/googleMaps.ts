/**
 * Google Maps Places API (New) — nearby / text search + place details (website, photos).
 */

import type { RestaurantOption } from "../types.js";

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.rating",
  "places.userRatingCount",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.photos",
].join(",");

const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "types",
  "primaryType",
  "rating",
  "userRatingCount",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "googleMapsUri",
  "websiteUri",
  "photos",
].join(",");

export function isGoogleMapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

export interface NearbySearchInput {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  keyword: string;
  preferences?: string[];
  maxResults?: number;
}

export interface GooglePlaceResult {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating?: number;
  userRatingCount?: number;
  phone?: string;
  primaryType?: string;
  types: string[];
  googleMapsUri?: string;
  websiteUri?: string;
  photoNames: string[];
  distanceMeters: number;
}

export interface GooglePlaceDetails extends GooglePlaceResult {
  photoUrls: string[];
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  return key;
}

export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function cuisineFromTypes(primaryType?: string, types: string[] = []): string[] {
  const raw = [primaryType, ...types].filter(Boolean) as string[];
  const cleaned = raw
    .map((t) =>
      t
        .replace(/_restaurant$/i, "")
        .replace(/_food$/i, "")
        .replace(/_/g, " ")
        .toLowerCase()
    )
    .filter(
      (t) =>
        ![
          "point of interest",
          "establishment",
          "food",
          "restaurant",
          "store",
          "meal takeaway",
          "meal delivery",
        ].includes(t)
    );
  return [...new Set(cleaned)].slice(0, 4);
}

function photoNamesFrom(place: Record<string, unknown>): string[] {
  const photos = place.photos as Array<{ name?: string }> | undefined;
  if (!Array.isArray(photos)) return [];
  return photos.map((p) => p.name).filter((n): n is string => Boolean(n));
}

function mapPlace(
  place: Record<string, unknown>,
  originLat: number,
  originLng: number
): GooglePlaceResult | null {
  const loc = place.location as { latitude?: number; longitude?: number } | undefined;
  const lat = loc?.latitude;
  const lng = loc?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const displayName = place.displayName as { text?: string } | undefined;
  const name = displayName?.text;
  if (!name) return null;

  const phone =
    (place.internationalPhoneNumber as string | undefined) ||
    (place.nationalPhoneNumber as string | undefined);

  const id =
    (place.id as string | undefined) ||
    `place_${name.replace(/\s+/g, "_").toLowerCase()}`;

  return {
    id,
    name,
    address: (place.formattedAddress as string | undefined) ?? "",
    latitude: lat,
    longitude: lng,
    rating: place.rating as number | undefined,
    userRatingCount: place.userRatingCount as number | undefined,
    phone,
    primaryType: place.primaryType as string | undefined,
    types: (place.types as string[] | undefined) ?? [],
    googleMapsUri: place.googleMapsUri as string | undefined,
    websiteUri: place.websiteUri as string | undefined,
    photoNames: photoNamesFrom(place),
    distanceMeters: Math.round(distanceMeters(originLat, originLng, lat, lng)),
  };
}

async function placesPost(
  path: "places:searchText" | "places:searchNearby",
  body: Record<string, unknown>,
  origin: { lat: number; lng: number }
): Promise<GooglePlaceResult[]> {
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as {
    places?: Record<string, unknown>[];
    error?: { message?: string };
  };

  if (!res.ok) {
    throw new Error(
      data.error?.message ?? `Google Places ${path} failed (${res.status})`
    );
  }

  return (data.places ?? [])
    .map((p) => mapPlace(p, origin.lat, origin.lng))
    .filter((p): p is GooglePlaceResult => p !== null);
}

function buildTextQuery(keyword: string, preferences: string[] = []): string {
  const parts = [keyword.trim(), ...preferences.map((p) => p.replace(/_/g, " "))];
  const unique = [...new Set(parts.filter(Boolean))];
  return `${unique.join(" ")} restaurants`.replace(/\s+/g, " ").trim();
}

export async function searchNearbyRestaurants(
  input: NearbySearchInput
): Promise<GooglePlaceResult[]> {
  if (!isGoogleMapsConfigured()) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set");
  }

  const maxResults = Math.min(input.maxResults ?? 10, 20);
  const radius = Math.min(Math.max(input.radiusMeters, 100), 50000);
  const center = { latitude: input.latitude, longitude: input.longitude };
  const textQuery = buildTextQuery(input.keyword, input.preferences);
  const origin = { lat: input.latitude, lng: input.longitude };

  try {
    const textResults = await placesPost(
      "places:searchText",
      {
        textQuery,
        maxResultCount: maxResults,
        locationBias: { circle: { center, radius } },
        includedType: "restaurant",
      },
      origin
    );
    if (textResults.length > 0) {
      return textResults.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
  } catch {
    /* nearby fallback */
  }

  const nearby = await placesPost(
    "places:searchNearby",
    {
      includedTypes: ["restaurant"],
      maxResultCount: maxResults,
      rankPreference: "DISTANCE",
      locationRestriction: { circle: { center, radius } },
    },
    origin
  );

  return nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** Resolve Places photo resource names to media URLs. */
export async function resolvePhotoUrls(
  photoNames: string[],
  max = 4
): Promise<string[]> {
  const urls: string[] = [];
  for (const name of photoNames.slice(0, max)) {
    try {
      const res = await fetch(
        `https://places.googleapis.com/v1/${name}/media?maxHeightPx=1200&skipHttpRedirect=true`,
        { headers: { "X-Goog-Api-Key": apiKey() } }
      );
      const data = (await res.json()) as { photoUri?: string };
      if (data.photoUri) urls.push(data.photoUri);
    } catch {
      /* skip */
    }
  }
  return urls;
}

export async function getPlaceDetails(
  placeId: string,
  origin?: { lat: number; lng: number }
): Promise<GooglePlaceDetails | null> {
  const id = placeId.startsWith("places/") ? placeId : `places/${placeId}`;
  const res = await fetch(`https://places.googleapis.com/v1/${id}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });
  const data = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!res.ok) return null;

  const originLat = origin?.lat ?? 0;
  const originLng = origin?.lng ?? 0;
  const mapped = mapPlace(data, originLat, originLng);
  if (!mapped) return null;

  const photoUrls = await resolvePhotoUrls(mapped.photoNames, 4);
  return { ...mapped, photoUrls };
}

export function toRestaurantOption(
  place: GooglePlaceResult & { photoUrls?: string[] },
  allergenConfidence: RestaurantOption["allergenConfidence"] = "needs_restaurant_check"
): RestaurantOption {
  return {
    id: place.id.startsWith("places/") ? place.id : `places/${place.id}`,
    name: place.name,
    cuisine: cuisineFromTypes(place.primaryType, place.types),
    location: {
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      placeId: place.id,
    },
    website: place.websiteUri,
    photoUrls: place.photoUrls,
    reservationPhone: place.phone ?? "Phone not listed — confirm via Google Maps",
    rating: place.rating,
    distanceMeters: place.distanceMeters,
    allergenConfidence,
  };
}
