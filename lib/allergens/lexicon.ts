import type { DietaryPreference, UkAllergen } from "../types.js";

export type AllergenVerdict = "clear" | "present" | "unknown";

export type AllergenEvidenceSource =
  | "menu_text"
  | "inferred_risk"
  | "explicit_free_from"
  | "not_mentioned";

export interface AllergenCheck {
  allergen: UkAllergen;
  status: AllergenVerdict;
  source: AllergenEvidenceSource;
  evidence?: string;
}

/** Legacy clients may still send FSA "nuts"; we store/emit tree_nuts. */
export function normalizeAllergenId(raw: string): UkAllergen | null {
  const id = raw.trim().toLowerCase();
  if (id === "nuts" || id === "tree_nut" || id === "treenuts") return "tree_nuts";
  const allowed: UkAllergen[] = [
    "celery",
    "cereals_containing_gluten",
    "crustaceans",
    "eggs",
    "fish",
    "lupin",
    "milk",
    "molluscs",
    "mustard",
    "tree_nuts",
    "peanuts",
    "sesame",
    "soya",
    "sulphur_dioxide",
  ];
  return allowed.includes(id as UkAllergen) ? (id as UkAllergen) : null;
}

export function normalizeAllergenList(list: string[] | undefined): UkAllergen[] {
  const out: UkAllergen[] = [];
  const seen = new Set<UkAllergen>();
  for (const raw of list ?? []) {
    const id = normalizeAllergenId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Keyword → UK 14 allergen (tree nuts named tree_nuts, not "nuts"). */
export const ALLERGEN_KEYWORDS: Record<UkAllergen, string[]> = {
  celery: ["celery", "celeriac"],
  cereals_containing_gluten: [
    "gluten",
    "wheat",
    "barley",
    "rye",
    "spelt",
    "batter",
    "breadcrumb",
    "breaded",
    "pastry",
    "noodles",
    "noodle",
    "spaghetti",
    "pasta",
    "wheat flour",
    "wheat protein",
    "wheat batter",
    "malt",
    "semolina",
  ],
  crustaceans: [
    "prawn",
    "shrimp",
    "crab",
    "lobster",
    "crayfish",
    "langoustine",
    "shellfish",
    "crustacean",
  ],
  eggs: ["egg", "eggs", "mayonnaise", "aioli", "meringue"],
  fish: [
    " fish",
    "anchovy",
    "anchovies",
    "salmon",
    "cod",
    "tuna",
    "haddock",
    "sea bass",
    "swordfish",
    "fish sauce",
  ],
  lupin: ["lupin", "lupine"],
  milk: [
    "milk",
    "cream",
    "butter",
    "cheese",
    "yoghurt",
    "yogurt",
    "dairy",
    "parmesan",
    "mozzarella",
    "ghee",
    "whey",
    "latte",
    "cappuccino",
  ],
  molluscs: [
    "mussel",
    "oyster",
    "squid",
    "calamari",
    "clam",
    "octopus",
    "scallop",
    "whelk",
    "snail",
  ],
  mustard: ["mustard"],
  tree_nuts: [
    "almond",
    "hazelnut",
    "walnut",
    "cashew",
    "pecan",
    "pistachio",
    "macadamia",
    "brazil nut",
    "pine nut",
    " treenut",
    "tree nut",
    "tree nuts",
    "mixed nuts",
    "nut butter",
    "praline",
    "marzipan",
    "frangipane",
  ],
  peanuts: ["peanut", "groundnut", "satay", "peanut butter"],
  sesame: ["sesame", "tahini", "benne"],
  soya: ["soya", "soy", "tofu", "edamame", "tempeh", "miso"],
  sulphur_dioxide: ["sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide"],
};

/**
 * Phrases that imply gluten risk even when "wheat"/"gluten" is not printed.
 * These yield status=unknown (or present if clearly wheat-based), never clear.
 */
const GLUTEN_RISK_KEYWORDS: Array<{ kw: string; evidence: string }> = [
  { kw: "soy sauce", evidence: "soy sauce (usually wheat)" },
  { kw: "soya sauce", evidence: "soya sauce (usually wheat)" },
  { kw: "shoyu", evidence: "shoyu (wheat soy sauce)" },
  { kw: "oyster sauce", evidence: "oyster sauce (often wheat)" },
  { kw: "hoisin", evidence: "hoisin (often wheat)" },
  { kw: "teriyaki", evidence: "teriyaki (often wheat)" },
  { kw: "bbq", evidence: "BBQ glaze (often malt/wheat)" },
  { kw: "barbecue", evidence: "barbecue sauce (often malt/wheat)" },
  { kw: "black bean", evidence: "black bean paste (often wheat)" },
  { kw: "fermented bean", evidence: "fermented bean paste (often wheat)" },
  { kw: "crispy", evidence: "crispy coating (usually wheat flour)" },
  { kw: "battered", evidence: "batter (usually wheat)" },
  { kw: "tempura", evidence: "tempura (usually wheat)" },
  { kw: "fried ", evidence: "fried item — shared fryer / coating risk" },
  { kw: "deep fried", evidence: "deep-fried — coating/fryer risk" },
  { kw: "crusted", evidence: "crust (flour source unknown)" },
  { kw: "coating", evidence: "coating (flour source unknown)" },
  { kw: "dumpling", evidence: "dumpling wrapper (usually wheat)" },
  { kw: "wonton", evidence: "wonton (usually wheat)" },
  { kw: "spring roll", evidence: "spring roll wrapper (often wheat)" },
  { kw: "seitan", evidence: "seitan (wheat gluten)" },
];

const GLUTEN_SAFE_OVERRIDES = [
  "gluten-free soy",
  "gluten free soy",
  "gf soy",
  "tamari",
  "coconut aminos",
  "rice flour",
  "cornflour",
  "cornstarch",
  "gluten-free",
  "gluten free",
  "no gluten",
  "without gluten",
  "coeliac-safe",
  "celiac-safe",
];

/** Explicit free-from claims in dish text. */
const FREE_FROM_PATTERNS: Partial<Record<UkAllergen, RegExp[]>> = {
  cereals_containing_gluten: [
    /\bgluten[- ]free\b/i,
    /\bno gluten\b/i,
    /\bwithout gluten\b/i,
    /\bgf\b/i,
    /\bcoeliac[- ]safe\b/i,
  ],
  tree_nuts: [/\bnut[- ]free\b/i, /\bno (tree )?nuts\b/i, /\bwithout nuts\b/i],
  peanuts: [/\bpeanut[- ]free\b/i, /\bno peanuts\b/i],
  crustaceans: [/\bshellfish[- ]free\b/i, /\bno (shellfish|crustaceans)\b/i],
  molluscs: [/\bshellfish[- ]free\b/i, /\bno molluscs?\b/i],
  milk: [/\bdairy[- ]free\b/i, /\bno dairy\b/i, /\blactose[- ]free\b/i],
  eggs: [/\begg[- ]free\b/i, /\bno eggs?\b/i],
  sesame: [/\bsesame[- ]free\b/i, /\bno sesame\b/i],
  soya: [/\bsoy[- ]free\b/i, /\bsoya[- ]free\b/i],
};

const MEAT_KEYWORDS = [
  "chicken",
  "beef",
  "pork",
  "lamb",
  "bacon",
  "steak",
  "duck",
  "turkey",
  "sausage",
  "chorizo",
  "prosciutto",
  "ham ",
  "meatball",
  "burger",
];

function maskCoconut(text: string): string {
  return text.toLowerCase().replace(/coconut/g, "coco_nut_safe");
}

function findKeyword(
  haystack: string,
  keywords: string[]
): string | undefined {
  for (const kw of keywords) {
    if (haystack.includes(kw.toLowerCase())) return kw;
  }
  return undefined;
}

export function detectAllergensInText(text: string): UkAllergen[] {
  const lower = ` ${maskCoconut(text)} `;
  const found = new Set<UkAllergen>();

  for (const [allergen, keywords] of Object.entries(ALLERGEN_KEYWORDS) as [
    UkAllergen,
    string[],
  ][]) {
    for (const kw of keywords) {
      if (!lower.includes(kw.toLowerCase())) continue;
      if (
        (allergen === "fish" || allergen === "crustaceans") &&
        (lower.includes("vegan") || lower.includes("chay") || lower.includes("plant"))
      ) {
        if (
          lower.includes("vegan fish") ||
          lower.includes("fish cake") ||
          lower.includes("phồng tôm chay") ||
          lower.includes("prawn chay")
        ) {
          continue;
        }
      }
      // Avoid bare "nut" matching "coconut" (already masked) and "minute"
      if (allergen === "tree_nuts" && (kw === " nut" || kw === "nut ")) {
        if (!/\b(nuts?|nutty)\b/.test(lower)) continue;
      }
      found.add(allergen);
      break;
    }
  }

  // Whole-word "nuts" (tree nuts) — not peanut (separate)
  if (/\bnuts?\b/.test(lower) && !lower.includes("coconut") && !lower.includes("peanut")) {
    found.add("tree_nuts");
  }

  return [...found];
}

function glutenRiskInText(text: string): { risk: boolean; evidence?: string } {
  const lower = ` ${text.toLowerCase()} `;
  if (GLUTEN_SAFE_OVERRIDES.some((p) => lower.includes(p))) {
    return { risk: false };
  }
  for (const { kw, evidence } of GLUTEN_RISK_KEYWORDS) {
    if (lower.includes(kw)) return { risk: true, evidence };
  }
  return { risk: false };
}

function hasExplicitFreeFrom(text: string, allergen: UkAllergen): boolean {
  const patterns = FREE_FROM_PATTERNS[allergen];
  if (patterns?.some((re) => re.test(text))) return true;
  // "nut-free" typically covers tree nuts + peanuts in UK menus
  if (
    (allergen === "tree_nuts" || allergen === "peanuts") &&
    FREE_FROM_PATTERNS.tree_nuts?.some((re) => re.test(text))
  ) {
    return true;
  }
  return false;
}

/** Allergens implied by dietary preferences (hard checks). */
export function allergensImpliedByPreferences(
  preferences: DietaryPreference[]
): UkAllergen[] {
  const out = new Set<UkAllergen>();
  for (const p of preferences) {
    switch (p) {
      case "gluten_free":
      case "coeliac":
        out.add("cereals_containing_gluten");
        break;
      case "dairy_free":
        out.add("milk");
        break;
      case "nut_free":
        out.add("tree_nuts");
        out.add("peanuts");
        break;
      case "shellfish_free":
        out.add("crustaceans");
        out.add("molluscs");
        break;
      default:
        break;
    }
  }
  return [...out];
}

export function assessAllergen(
  text: string,
  allergen: UkAllergen,
  detected: UkAllergen[]
): AllergenCheck {
  if (hasExplicitFreeFrom(text, allergen)) {
    return {
      allergen,
      status: "clear",
      source: "explicit_free_from",
      evidence: "menu claims free-from",
    };
  }

  if (detected.includes(allergen)) {
    const hit = findKeyword(
      ` ${maskCoconut(text)} `,
      ALLERGEN_KEYWORDS[allergen]
    );
    return {
      allergen,
      status: "present",
      source: "menu_text",
      evidence: hit ? `matched "${hit}"` : "keyword match",
    };
  }

  if (allergen === "cereals_containing_gluten") {
    const { risk, evidence } = glutenRiskInText(text);
    if (risk) {
      return {
        allergen,
        status: "unknown",
        source: "inferred_risk",
        evidence,
      };
    }
  }

  // Absence of a mention is not clearance for allergy demos
  return {
    allergen,
    status: "unknown",
    source: "not_mentioned",
    evidence: "no positive free-from claim in dish text",
  };
}

export function preferenceConflicts(
  text: string,
  preferences: DietaryPreference[],
  checks: AllergenCheck[],
  detected: UkAllergen[]
): DietaryPreference[] {
  const lower = ` ${text.toLowerCase()} `;
  const markedVegan = /\bvegan\b|\bplant[- ]based\b|\bchay\b/.test(lower);
  const byAllergen = new Map(checks.map((c) => [c.allergen, c]));
  const conflicts: DietaryPreference[] = [];

  const statusOf = (a: UkAllergen): AllergenVerdict =>
    byAllergen.get(a)?.status ??
    (detected.includes(a) ? "present" : "unknown");

  for (const pref of preferences) {
    switch (pref) {
      case "vegan":
        if (markedVegan) break;
        if (
          ["milk", "eggs", "fish", "crustaceans", "molluscs"].some(
            (a) => statusOf(a as UkAllergen) === "present"
          ) ||
          MEAT_KEYWORDS.some((m) => lower.includes(m))
        ) {
          conflicts.push(pref);
        }
        break;
      case "vegetarian":
      case "pescatarian":
        if (
          MEAT_KEYWORDS.some((m) => lower.includes(m)) ||
          (pref === "vegetarian" &&
            ["fish", "crustaceans", "molluscs"].some(
              (a) => statusOf(a as UkAllergen) === "present"
            ))
        ) {
          conflicts.push(pref);
        }
        break;
      case "gluten_free":
      case "coeliac": {
        const g = statusOf("cereals_containing_gluten");
        // Soft "looks fine" is not enough — only explicit clear passes
        if (g !== "clear") conflicts.push(pref);
        break;
      }
      case "dairy_free":
        if (statusOf("milk") === "present") conflicts.push(pref);
        else if (statusOf("milk") === "unknown" && !hasExplicitFreeFrom(text, "milk")) {
          // dairy_free without claim: don't soft-pass if milk risk words absent —
          // still conflict unknown for strict demo? Keep softer for dairy: only present blocks.
        }
        break;
      case "nut_free":
        if (
          statusOf("tree_nuts") === "present" ||
          statusOf("peanuts") === "present"
        ) {
          conflicts.push(pref);
        } else if (
          statusOf("tree_nuts") !== "clear" &&
          statusOf("peanuts") !== "clear"
        ) {
          // No free-from claim → do not assert nut_free
          conflicts.push(pref);
        }
        break;
      case "shellfish_free":
        if (
          statusOf("crustaceans") === "present" ||
          statusOf("molluscs") === "present"
        ) {
          conflicts.push(pref);
        }
        break;
      default:
        break;
    }
  }
  return conflicts;
}

/** Preferences we may list under suitableFor (only when positively supported). */
export function preferencesSatisfied(
  text: string,
  preferences: DietaryPreference[],
  checks: AllergenCheck[],
  detected: UkAllergen[],
  conflicts: DietaryPreference[]
): DietaryPreference[] {
  const lower = ` ${text.toLowerCase()} `;
  const conflictSet = new Set(conflicts);
  const byAllergen = new Map(checks.map((c) => [c.allergen, c]));
  const statusOf = (a: UkAllergen): AllergenVerdict =>
    byAllergen.get(a)?.status ??
    (detected.includes(a) ? "present" : "unknown");

  return preferences.filter((pref) => {
    if (conflictSet.has(pref)) return false;
    switch (pref) {
      case "gluten_free":
      case "coeliac":
        return statusOf("cereals_containing_gluten") === "clear";
      case "nut_free":
        return (
          statusOf("tree_nuts") === "clear" && statusOf("peanuts") === "clear"
        );
      case "dairy_free":
        return (
          statusOf("milk") === "clear" ||
          (statusOf("milk") !== "present" &&
            (/\bdairy[- ]free\b|\bvegan\b/.test(lower) ||
              !detectAllergensInText(text).includes("milk")))
        );
      case "vegan":
        return (
          /\bvegan\b|\bplant[- ]based\b|\bchay\b/.test(lower) ||
          !conflictSet.has("vegan")
        );
      default:
        return true;
    }
  });
}

export function dishMatchesRestrictions(
  text: string,
  avoidAllergens: UkAllergen[],
  preferences: DietaryPreference[]
): {
  ok: boolean;
  allergensPresent: UkAllergen[];
  preferenceConflicts: DietaryPreference[];
  suitableFor: DietaryPreference[];
  allergenChecks: AllergenCheck[];
} {
  const avoid = normalizeAllergenList(avoidAllergens);
  const implied = allergensImpliedByPreferences(preferences);
  const tracked = [...new Set([...avoid, ...implied])];

  const detected = detectAllergensInText(text);
  const allergenChecks = tracked.map((a) => assessAllergen(text, a, detected));

  // Block if any avoided allergen is present OR unknown (can't seat on unknown)
  const blocked = allergenChecks.filter(
    (c) =>
      avoid.includes(c.allergen) &&
      (c.status === "present" || c.status === "unknown")
  );

  const prefs = preferenceConflicts(text, preferences, allergenChecks, detected);
  const suitableFor = preferencesSatisfied(
    text,
    preferences,
    allergenChecks,
    detected,
    prefs
  );

  // Also surface detected allergens that weren't in the tracked list
  const allergensPresent = [
    ...new Set([
      ...detected,
      ...allergenChecks.filter((c) => c.status === "present").map((c) => c.allergen),
    ]),
  ];

  return {
    ok: blocked.length === 0 && prefs.length === 0,
    allergensPresent,
    preferenceConflicts: prefs,
    suitableFor,
    allergenChecks,
  };
}
