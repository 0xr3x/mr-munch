import {
  dishMatchesRestrictions,
} from "../allergens/lexicon.js";
import type {
  DietaryPreference,
  MenuItem,
  UkAllergen,
} from "../types.js";

export interface ParsedDish {
  name: string;
  description: string;
  priceGbp?: number;
  raw: string;
  allergensPresent: UkAllergen[];
  suitable: boolean;
  preferenceConflicts: DietaryPreference[];
}

const PRICE_RE = /(?:£\s*)(\d+(?:\.\d{1,2})?)\s*$/;
const NUMBERED_RE = /^\s*\d+[a-z]?\.\s+(.+)$/i;

export function parseDishesFromMarkdown(markdown: string): ParsedDish[] {
  const lines = markdown.split(/\r?\n/);
  const dishes: ParsedDish[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
    if (line.length < 4 || line.length > 280) continue;
    if (/^(starters|mains|desserts|drinks|sides|welcome|home)/i.test(line)) {
      continue;
    }

    const numbered = line.match(NUMBERED_RE);
    const priceMatch = line.match(PRICE_RE);
    const looksLikeDish =
      numbered ||
      priceMatch ||
      (/\[[^\]]*vegan[^\]]*\]/i.test(line) && line.length < 160);

    if (!looksLikeDish) continue;

    let name = numbered ? numbered[1] : line;
    let priceGbp: number | undefined;
    if (priceMatch) {
      priceGbp = Number(priceMatch[1]);
      name = name.replace(PRICE_RE, "").trim();
    }

    // Strip trailing link markup from markdown titles
    name = name.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    // "Name Description 13.00" patterns without £
    const trailingPrice = name.match(/^(.*?)\s+(\d+\.\d{2})\s*$/);
    if (trailingPrice && !priceGbp) {
      name = trailingPrice[1].trim();
      priceGbp = Number(trailingPrice[2]);
    }

    // Next non-empty line as description if short title
    let description = "";
    if (numbered && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (
        next &&
        !NUMBERED_RE.test(next) &&
        next.length > 20 &&
        next.length < 400 &&
        !/^#{1,3}\s/.test(next)
      ) {
        description = next.replace(/\*\*/g, "");
      }
    }

    // For link-style "Name Description price"
    if (!description && name.length > 40) {
      const parts = name.split(/\s{2,}|\s+-\s+/);
      if (parts.length >= 2) {
        description = parts.slice(1).join(" ");
        name = parts[0];
      }
    }

    name = name.replace(/\s*\[Vegan.*?\]/gi, "").trim();
    if (name.length < 3) continue;

    const raw = `${name}. ${description}`.trim();
    dishes.push({
      name: name.slice(0, 120),
      description: description.slice(0, 400),
      priceGbp,
      raw,
      allergensPresent: [],
      suitable: true,
      preferenceConflicts: [],
    });
  }

  // Deduplicate by name
  const seen = new Set<string>();
  return dishes.filter((d) => {
    const key = d.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function annotateDishes(
  dishes: ParsedDish[],
  avoidAllergens: UkAllergen[],
  preferences: DietaryPreference[]
): ParsedDish[] {
  return dishes.map((d) => {
    const check = dishMatchesRestrictions(d.raw, avoidAllergens, preferences);
    return {
      ...d,
      allergensPresent: check.allergensPresent,
      suitable: check.ok,
      preferenceConflicts: check.preferenceConflicts,
    };
  });
}

export function toMenuItems(
  dishes: ParsedDish[],
  limit = 8,
  preferences: DietaryPreference[] = []
): MenuItem[] {
  const suitable = dishes.filter((d) => d.suitable);
  const pick = (suitable.length > 0 ? suitable : dishes).slice(0, limit);

  return pick.map((d) => {
    let course: MenuItem["course"] = "main";
    const n = d.name.toLowerCase();
    if (/roll|salad|starter|soup|dumpling|pancake|cracker/.test(n)) {
      course = "starter";
    } else if (/dessert|ice cream|cake|pudding|chocolate|posset/.test(n)) {
      course = "dessert";
    } else if (/side|chips|rice$|kimchi$/.test(n)) {
      course = "side";
    } else if (/drink|cola|water|juice|tea|coffee/.test(n)) {
      course = "drink";
    }

    return {
      name: d.name,
      description: d.description || "From restaurant website menu",
      course,
      priceGbp: d.priceGbp ?? 0,
      allergensPresent: d.allergensPresent,
      suitableFor: d.suitable ? preferences : [],
      notes: d.suitable
        ? "Inferred from website text — confirm with restaurant before booking."
        : `May conflict: ${[...d.allergensPresent, ...d.preferenceConflicts].join(", ")}`,
    };
  });
}

export function estimatePriceFromDishes(
  dishes: ParsedDish[],
  partySize: number
): { perPersonGbp: number; totalGbp: number } {
  const priced = dishes.filter((d) => d.suitable && d.priceGbp && d.priceGbp > 0);
  const sample = priced.slice(0, 4);
  if (sample.length === 0) {
    const perPersonGbp = 30;
    return { perPersonGbp, totalGbp: perPersonGbp * partySize };
  }
  const avg =
    sample.reduce((s, d) => s + (d.priceGbp ?? 0), 0) / sample.length;
  // Rough full-meal: starter-ish + main
  const perPersonGbp = Number((avg * 1.8).toFixed(2));
  return {
    perPersonGbp,
    totalGbp: Number((perPersonGbp * partySize).toFixed(2)),
  };
}
