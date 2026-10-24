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
  AllergenConfidence,
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
  /** @deprecated prefer menuPhotoUrls / siteImageUrls */
  photoUrls: string[];
  menuPhotoUrls: string[];
  siteImageUrls: string[];
  dishes: ParsedDish[];
  suitableCount: number;
  totalParsed: number;
  suggestedMenu: SuggestedMenu;
  priceEstimate: PriceEstimate;
  allergenConfidence: AllergenConfidence;
  sources: string[];
}

function classifySiteImages(urls: string[]): {
  menuPhotoUrls: string[];
  siteImageUrls: string[];
} {
  const menuPhotoUrls: string[] = [];
  const siteImageUrls: string[] = [];
  for (const url of urls) {
    const u = url.toLowerCase();
    if (
      /logo|wordmark|favicon|icon|sprite|avatar|banner-brand/.test(u)
    ) {
      siteImageUrls.push(url);
      continue;
    }
    if (/menu|specials?|allergen|board|carta|food-menu/.test(u)) {
      menuPhotoUrls.push(url);
      continue;
    }
    // Dish marketing shots — not menu OCR evidence
    siteImageUrls.push(url);
  }
  return {
    menuPhotoUrls: [...new Set(menuPhotoUrls)].slice(0, 8),
    siteImageUrls: [...new Set(siteImageUrls)].slice(0, 8),
  };
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
      if (/page not found|404 error/i.test(page.markdown) && page.markdown.length < 800) {
        continue;
      }
      pages.push({ url: page.url, markdown: page.markdown });
      images.push(...extractImageUrls(page.markdown));
    }
  }

  return { pages, images: [...new Set(images)].slice(0, 12) };
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
      allergenChecks: [],
      suitable: true,
      suitableFor: [],
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
  const googlePhotos = [...(place.photoUrls ?? [])];
  let siteImages: string[] = [];
  let dishes: ParsedDish[] = [];
  const pagesFetched: string[] = [];
  let sawPdfOrMenuPage = false;
  let usedVision = false;

  if (place.websiteUri) {
    const { pages, images } = await gatherMarkdown(place.websiteUri);
    siteImages.push(...images);
    for (const page of pages) {
      pagesFetched.push(page.url);
      sources.push(`website:${page.url}`);
      if (/\.pdf($|\?)|\/menu/i.test(page.url)) sawPdfOrMenuPage = true;

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

  const classified = classifySiteImages(siteImages);
  // Only run vision on images that look like menus, else Google place photos
  const visionCandidates =
    classified.menuPhotoUrls.length > 0
      ? classified.menuPhotoUrls
      : googlePhotos;

  if (isOpenAiConfigured() && visionCandidates.length > 0 && dishes.length < 3) {
    for (const img of visionCandidates.slice(0, 2)) {
      try {
        const vision = await recogniseMenuFromImage(img);
        sources.push(`openai_vision:${img.slice(0, 60)}`);
        usedVision = true;
        const visionDishes = annotateDishes(
          vision.dishes.map((d) => ({
            name: d.name,
            description: d.description ?? "",
            priceGbp: d.priceGbp,
            raw: `${d.name}. ${d.description ?? ""}`,
            allergensPresent: [],
            allergenChecks: [],
            suitable: true,
            suitableFor: [],
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

  // Ladder: needs_restaurant_check → website_text → menu_inferred → kitchen_confirmed
  let allergenConfidence: AllergenConfidence = "needs_restaurant_check";
  if (dishes.length > 0 && pagesFetched.length > 0) {
    allergenConfidence =
      usedVision || sawPdfOrMenuPage ? "menu_inferred" : "website_text";
  } else if (usedVision && dishes.length > 0) {
    allergenConfidence = "menu_inferred";
  }

  const menuPhotoUrls = [
    ...classified.menuPhotoUrls,
    ...(usedVision ? visionCandidates.slice(0, 2) : []),
  ];
  const siteImageUrls = classified.siteImageUrls;
  const photoUrls = [...menuPhotoUrls, ...siteImageUrls].slice(0, 8);

  return {
    website: place.websiteUri,
    pagesFetched,
    photoUrls,
    menuPhotoUrls: [...new Set(menuPhotoUrls)].slice(0, 8),
    siteImageUrls: [...new Set(siteImageUrls)].slice(0, 8),
    dishes,
    suitableCount: suitable.length,
    totalParsed: dishes.length,
    suggestedMenu: {
      items,
      notes:
        dishes.length > 0
          ? `Parsed ${dishes.length} dishes; ${suitable.length} pass hard checks for (${prefLabel}; avoid: ${allergenLabel}). Per-dish allergenChecks use clear|present|unknown — unknown means ask the kitchen. Never treat website inference as kitchen confirmation.`
          : `No structured menu found on website yet. Preferences: ${prefLabel}; avoid: ${allergenLabel}. Saint should ask the restaurant.`,
    },
    priceEstimate: {
      currency: "GBP",
      perPersonGbp: price.perPersonGbp,
      totalGbp: price.totalGbp,
      includes: "Approx. from listed dish prices; excludes drinks & service",
    },
    allergenConfidence,
    sources,
  };
}
