/**
 * OpenStreetMap Overpass — verify diet:vegan / diet:vegetarian flags.
 * Free, no API key. Identify the app via User-Agent (OSM usage policy).
 *
 * Tags: https://wiki.openstreetmap.org/wiki/Key:diet
 *   diet:vegan=yes|only|limited|no
 *   diet:vegetarian=yes|only|limited|no
 */

import { distanceMeters } from "./googleMaps.js";

export type OsmDietValue = "yes" | "only" | "limited" | "no" | "unknown";

export interface OsmDietPlace {
  osmId: string;
  name: string;
  latitude: number;
  longitude: number;
  vegan: OsmDietValue;
  vegetarian: OsmDietValue;
  amenity?: string;
  cuisine?: string;
  phone?: string;
  website?: string;
  rawTags: Record<string, string>;
}

export interface OsmDietMatch {
  matched: boolean;
  place?: OsmDietPlace;
  distanceMeters?: number;
  nameScore?: number;
}

function userAgent(): string {
  // Keep UA simple — Overpass/nginx returns 406 for some parenthetical UAs
  return process.env.OSM_USER_AGENT ?? "MrMunch/0.1";
}

export function isOsmConfigured(): boolean {
  // Overpass is always usable; UA has a safe default.
  return true;
}

function normalizeDiet(v: string | undefined): OsmDietValue {
  if (!v) return "unknown";
  const x = v.toLowerCase().trim();
  if (x === "yes" || x === "only" || x === "limited" || x === "no") return x;
  if (x === "friendly") return "yes";
  return "unknown";
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens that are branch / area qualifiers — must not alone justify a far match. */
const BRANCH_STOP = new Set([
  "the",
  "and",
  "restaurant",
  "cafe",
  "café",
  "bar",
  "kitchen",
  "london",
  "uk",
]);

function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length > 1 && !BRANCH_STOP.has(t));
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/** Extra location tokens on Google (Soho, Victoria…) not present on OSM → require tighter geo. */
function unmatchedBranchTokens(googleName: string, osmName: string): string[] {
  const g = nameTokens(googleName);
  const o = new Set(nameTokens(osmName));
  // Brand-ish first token shared → remaining google tokens are branch hints
  if (g.length <= 1) return [];
  const brand = g[0];
  if (!o.has(brand) && ![...o].some((t) => brand.includes(t) || t.includes(brand))) {
    return [];
  }
  return g.slice(1).filter((t) => ![...o].some((ot) => ot.includes(t) || t.includes(ot)));
}

const OVERPASS_ENDPOINTS = [
  // Primary: FR mirror — main overpass-api.de often returns 406 from cloud/Vercel IPs
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function overpass(query: string, timeoutMs = 28_000): Promise<OsmDietPlace[]> {
  let lastError = "overpass_failed";

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Try GET first (reliable for compact queries), then POST
      let res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": userAgent() },
      });
      if (!res.ok) {
        res = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "User-Agent": userAgent(),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }).toString(),
        });
      }
      if (!res.ok) {
        lastError = `overpass_http_${res.status}`;
        continue;
      }
      const data = (await res.json()) as {
        elements?: Array<{
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };

      const places: OsmDietPlace[] = [];
      for (const e of data.elements ?? []) {
        const tags = e.tags ?? {};
        const lat = e.lat ?? e.center?.lat;
        const lon = e.lon ?? e.center?.lon;
        const name = tags.name;
        if (lat == null || lon == null || !name) continue;
        places.push({
          osmId: `${e.type}/${e.id}`,
          name,
          latitude: lat,
          longitude: lon,
          vegan: normalizeDiet(tags["diet:vegan"]),
          vegetarian: normalizeDiet(tags["diet:vegetarian"]),
          amenity: tags.amenity,
          cuisine: tags.cuisine,
          phone: tags.phone ?? tags["contact:phone"],
          website: tags.website ?? tags["contact:website"],
          rawTags: tags,
        });
      }
      return places;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "overpass_error";
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

/** Nearby OSM food places tagged vegan and/or vegetarian. */
export async function searchOsmDietPlaces(input: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  veganOnly?: boolean;
}): Promise<OsmDietPlace[]> {
  const radius = Math.min(Math.max(input.radiusMeters ?? 1500, 100), 10000);
  const { latitude: lat, longitude: lon } = input;

  // Keep query compact — long Overpass URLs/bodies often fail with nginx 406 from cloud IPs
  const query = input.veganOnly
    ? `[out:json][timeout:25];(node["diet:vegan"~"yes|only|limited"](around:${radius},${lat},${lon});way["diet:vegan"~"yes|only|limited"](around:${radius},${lat},${lon}););out center tags 50;`
    : `[out:json][timeout:25];(node["diet:vegan"~"yes|only|limited"](around:${radius},${lat},${lon});node["diet:vegetarian"~"yes|only|limited"](around:${radius},${lat},${lon});way["diet:vegan"~"yes|only|limited"](around:${radius},${lat},${lon});way["diet:vegetarian"~"yes|only|limited"](around:${radius},${lat},${lon}););out center tags 60;`;

  const places = await overpass(query);
  // Dedupe by osmId
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.osmId)) return false;
    seen.add(p.osmId);
    return true;
  });
}

/**
 * Match a Google place to a nearby OSM diet-tagged venue.
 * Distance is always hard-capped — a shared brand name must not attach a
 * node 2km away to every chain branch (Mildreds Soho ≠ Mildreds Victoria).
 */
export function matchGoogleToOsm(
  google: { name: string; latitude: number; longitude: number },
  osmPlaces: OsmDietPlace[],
  maxDistanceMeters = 150
): OsmDietMatch {
  let best: OsmDietMatch = { matched: false };

  for (const osm of osmPlaces) {
    const dist = distanceMeters(
      google.latitude,
      google.longitude,
      osm.latitude,
      osm.longitude
    );
    const nameScore = nameSimilarity(google.name, osm.name);
    const branchExtra = unmatchedBranchTokens(google.name, osm.name);

    // Hard geo gate — never inherit diet tags across the city
    let maxDist = maxDistanceMeters;
    if (branchExtra.length > 0) {
      // Google has "Soho" / "Covent Garden" etc. OSM name doesn't → must be same site
      maxDist = Math.min(maxDist, 80);
    }
    if (dist > maxDist) continue;
    if (nameScore < 0.45) continue;

    const score = nameScore * 10 - dist / 40 - branchExtra.length * 2;
    const prev =
      (best.nameScore ?? 0) * 10 - (best.distanceMeters ?? 9999) / 40;
    if (!best.matched || score > prev) {
      best = {
        matched: true,
        place: osm,
        distanceMeters: Math.round(dist),
        nameScore: Number(nameScore.toFixed(2)),
      };
    }
  }
  return best;
}

export function osmSupportsPreference(
  place: OsmDietPlace,
  preferences: string[]
): { ok: boolean; reason: string } {
  const wantsVegan = preferences.includes("vegan");
  const wantsVeg =
    preferences.includes("vegetarian") || preferences.includes("vegan");

  if (wantsVegan) {
    if (place.vegan === "only" || place.vegan === "yes") {
      return { ok: true, reason: `osm_diet:vegan=${place.vegan}` };
    }
    if (place.vegan === "limited") {
      return { ok: true, reason: "osm_diet:vegan=limited" };
    }
    if (place.vegan === "no") {
      return { ok: false, reason: "osm_diet:vegan=no" };
    }
  }

  if (wantsVeg) {
    if (
      place.vegetarian === "only" ||
      place.vegetarian === "yes" ||
      place.vegan === "only" ||
      place.vegan === "yes"
    ) {
      return {
        ok: true,
        reason: `osm_diet:vegetarian=${place.vegetarian}/vegan=${place.vegan}`,
      };
    }
    if (place.vegetarian === "no" && place.vegan === "no") {
      return { ok: false, reason: "osm_diet:vegetarian=no" };
    }
  }

  return { ok: true, reason: "osm_no_conflicting_diet_tag" };
}

export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<string | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
    { headers: { "User-Agent": userAgent(), Accept: "application/json" } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? null;
}
