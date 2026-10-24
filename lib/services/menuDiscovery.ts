/**
 * Discover menus from restaurant websites (and photo URLs when available),
 * then check dishes against allergens / dietary preferences.
 */

import {
  annotateDishes,
  estimatePriceFromDishes,
  parseDishesFromMarkdown,
  toMenuItems,
  type ParsedDish,
} from "../menu/parseMenu.js";
import type {
  DietaryPreference,
  MenuItem,
  PriceEstimate,
  SuggestedMenu,
  UkAllergen,
} from "../types.js";
import {
  isOpenAiConfigured,
  recogniseMenuFromImage,
  recogniseMenuFromText,
} from "./openaiVision.js";
import {
  extractImageUrls,
  extractMenuCandidateUrls,
  fetchPageMarkdown,
} from "./webReader.js";
import type { GooglePlaceDetails } from "./googleMaps.js";

export interface MenuDiscoveryResult {
  website?: string;
  pagesFetched: string[];
  photoUrls: string[];
  dishes: ParsedDish[];
  suitableCount: number;
  totalParsed: number;
  suggestedMenu: SuggestedMenu;
  priceEstimate: PriceEstimate;
  allergenConfidence: "menu_inferred" | "needs_restaurant_check";
  sources: string[];
}

async function gatherMarkdown(
  website: string
): Promise<{ pages: Array<{ url: string; markdown: string }>; images: string[] }> {
  const home = await fetchPageMarkdown(website);
  const pages: Array<{ url: string; markdown: string }> = [];
  const images: string[] = [];

  if (home.ok) {
    pages.push({ url: home.url, markdown: home.markdown });
    images.push(...extractImageUrls(home.markdown));

    const candidates = extractMenuCandidateUrls(home.markdown, website).filter(
      (u) => u.replace(/\/$/, "") !== website.replace(/\/$/, "")
    );

    const extras = await Promise.all(
      candidates.slice(0, 2).map((u) => fetchPageMarkdown(u))
    );
    for (const page of extras) {
      if (!page.ok) continue;
      // Skip thin 404 pages
      if (/page not found|404 error/i.test(page.markdown) && page.markdown.length < 800) {
        continue;
      }
      pages.push({ url: page.url, markdown: page.markdown });
      images.push(...extractImageUrls(page.markdown));
    }
  }

  return { pages, images: [...new Set(images)].slice(0, 6) };
}

async function dishesFromOpenAiText(
  markdown: string,
  avoidAllergens: UkAllergen[],
  preferences: DietaryPreference[]
): Promise<ParsedDish[]> {
  const result = await recogniseMenuFromText(markdown.slice(0, 14000));
  return annotateDishes(
    result.dishes.map((d) => ({
      name: d.name,
      description: d.description ?? "",
      priceGbp: d.priceGbp,
      raw: `${d.name}. ${d.description ?? ""} allergens:${(d.allergensSuspected ?? []).join(",")}`,
      allergensPresent: [],
      suitable: true,
      preferenceConflicts: [],
    })),
    avoidAllergens,
    preferences
  );
}

export async function discoverMenuForPlace(
  place: Pick<GooglePlaceDetails, "name" | "websiteUri" | "photoUrls">,
  opts: {
    partySize: number;
    allergens: UkAllergen[];
    preferences: DietaryPreference[];
  }
): Promise<MenuDiscoveryResult> {
  const sources: string[] = [];
  const photoUrls = [...(place.photoUrls ?? [])];
  let dishes: ParsedDish[] = [];
  const pagesFetched: string[] = [];

  if (place.websiteUri) {
    const { pages, images } = await gatherMarkdown(place.websiteUri);
    photoUrls.push(...images);
    for (const page of pages) {
      pagesFetched.push(page.url);
      sources.push(`website:${page.url}`);

      let pageDishes: ParsedDish[] = [];
      if (isOpenAiConfigured()) {
        try {
          pageDishes = await dishesFromOpenAiText(
            page.markdown,
            opts.allergens,
            opts.preferences
          );
          sources.push("openai_text_menu");
        } catch {
          pageDishes = annotateDishes(
            parseDishesFromMarkdown(page.markdown),
            opts.allergens,
            opts.preferences
          );
          sources.push("heuristic_menu_parse");
        }
      } else {
        pageDishes = annotateDishes(
          parseDishesFromMarkdown(page.markdown),
          opts.allergens,
          opts.preferences
        );
        sources.push("heuristic_menu_parse");
      }
      dishes.push(...pageDishes);
    }
  }

  // Optional: OpenAI vision on a couple of page/Google photos
  if (isOpenAiConfigured() && photoUrls.length > 0 && dishes.length < 3) {
    for (const img of photoUrls.slice(0, 2)) {
      try {
        const vision = await recogniseMenuFromImage(img);
        sources.push(`openai_vision:${img.slice(0, 60)}`);
        const visionDishes = annotateDishes(
          vision.dishes.map((d) => ({
            name: d.name,
            description: d.description ?? "",
            priceGbp: d.priceGbp,
            raw: `${d.name}. ${d.description ?? ""}`,
            allergensPresent: [],
            suitable: true,
            preferenceConflicts: [],
          })),
          opts.allergens,
          opts.preferences
        );
        dishes.push(...visionDishes);
      } catch {
        /* vision optional */
      }
    }
  }

  // Dedupe
  const seen = new Set<string>();
  dishes = dishes.filter((d) => {
    const k = d.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const suitable = dishes.filter((d) => d.suitable);
  const items: MenuItem[] = toMenuItems(dishes, 8, opts.preferences);
  const price = estimatePriceFromDishes(dishes, opts.partySize);

  const prefLabel =
    opts.preferences.length > 0 ? opts.preferences.join(", ") : "none";
  const allergenLabel =
    opts.allergens.length > 0 ? opts.allergens.join(", ") : "none";

  return {
    website: place.websiteUri,
    pagesFetched,
    photoUrls: [...new Set(photoUrls)].slice(0, 8),
    dishes,
    suitableCount: suitable.length,
    totalParsed: dishes.length,
    suggestedMenu: {
      items,
      notes:
        dishes.length > 0
          ? `Parsed ${dishes.length} dishes from website/photos; ${suitable.length} look suitable for (${prefLabel}; avoid: ${allergenLabel}). Inferred only — confirm with the restaurant before booking.`
          : `No structured menu found on website yet. Preferences: ${prefLabel}; avoid: ${allergenLabel}. Saint should ask the restaurant.`,
    },
    priceEstimate: {
      currency: "GBP",
      perPersonGbp: price.perPersonGbp,
      totalGbp: price.totalGbp,
      includes: "Approx. from listed dish prices; excludes drinks & service",
    },
    allergenConfidence:
      dishes.length >= 3 ? "menu_inferred" : "needs_restaurant_check",
    sources,
  };
}
