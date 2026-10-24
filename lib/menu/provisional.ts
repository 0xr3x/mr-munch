/**
 * Provisional menus until Atlas + OpenAI vision supply real dishes.
 * Picks a template that best matches preferences / food type.
 */

import type {
  DietaryPreference,
  MenuItem,
  PriceEstimate,
  RecommendRequest,
  SuggestedMenu,
  UkAllergen,
} from "../types.js";

const VEGAN_GF: MenuItem[] = [
  {
    name: "Roasted beetroot & citrus",
    description: "Orange, horseradish oat cream — nut-free",
    course: "starter",
    priceGbp: 9.5,
    allergensPresent: [],
    suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free", "nut_free"],
  },
  {
    name: "Charred cauliflower steak",
    description: "Herb oil; sesame optional on the side",
    course: "main",
    priceGbp: 16.5,
    allergensPresent: [],
    suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free", "nut_free"],
    notes: "Provisional — confirm allergens with the restaurant before booking.",
  },
  {
    name: "Herb polenta chips",
    description: "House ketchup",
    course: "side",
    priceGbp: 5.5,
    allergensPresent: [],
    suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free", "nut_free"],
  },
  {
    name: "Dark chocolate pot",
    description: "Coconut cream, raspberry",
    course: "dessert",
    priceGbp: 7.5,
    allergensPresent: ["soya"],
    suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free", "nut_free"],
  },
];

const SHELLFISH_SAFE_ASIAN: MenuItem[] = [
  {
    name: "Vegetable tom yum",
    description: "No fish sauce — lemongrass & galangal",
    course: "starter",
    priceGbp: 8,
    allergensPresent: [],
    suitableFor: ["vegan", "vegetarian", "gluten_free", "shellfish_free", "dairy_free"],
  },
  {
    name: "Pad see ew (tofu)",
    description: "Rice noodles, gluten-free soy",
    course: "main",
    priceGbp: 14.5,
    allergensPresent: ["soya"],
    suitableFor: ["vegetarian", "shellfish_free", "nut_free"],
    notes: "Provisional — ask kitchen to omit egg for vegan.",
  },
  {
    name: "Crispy morning glory",
    description: "Garlic, chilli",
    course: "side",
    priceGbp: 6,
    allergensPresent: [],
    suitableFor: [
      "vegan",
      "vegetarian",
      "gluten_free",
      "shellfish_free",
      "dairy_free",
      "nut_free",
    ],
  },
  {
    name: "Mango sticky rice",
    description: "Coconut milk",
    course: "dessert",
    priceGbp: 6.5,
    allergensPresent: [],
    suitableFor: [
      "vegan",
      "vegetarian",
      "gluten_free",
      "dairy_free",
      "nut_free",
      "shellfish_free",
    ],
  },
];

const COELIAC_BRITISH: MenuItem[] = [
  {
    name: "Celeriac remoulade",
    description: "Ask mustard-free if needed",
    course: "starter",
    priceGbp: 8.5,
    allergensPresent: ["mustard", "eggs"],
    suitableFor: ["gluten_free", "coeliac", "shellfish_free", "nut_free"],
  },
  {
    name: "Herb chicken, roast roots",
    description: "Dedicated GF prep when confirmed",
    course: "main",
    priceGbp: 19,
    allergensPresent: [],
    suitableFor: ["gluten_free", "coeliac", "shellfish_free", "nut_free", "dairy_free"],
    notes: "Provisional — confirm dedicated gluten-free prep.",
  },
  {
    name: "Triple-cooked chips",
    description: "Request dedicated fryer",
    course: "side",
    priceGbp: 5,
    allergensPresent: [],
    suitableFor: [
      "vegan",
      "vegetarian",
      "gluten_free",
      "coeliac",
      "dairy_free",
      "nut_free",
      "shellfish_free",
    ],
  },
  {
    name: "Lemon posset",
    description: "GF biscuit on request",
    course: "dessert",
    priceGbp: 7,
    allergensPresent: ["milk", "eggs"],
    suitableFor: ["gluten_free", "coeliac", "shellfish_free", "nut_free"],
  },
];

const DEFAULT_EURO: MenuItem[] = [
  {
    name: "Seasonal soup",
    description: "Ask for dairy/gluten status",
    course: "starter",
    priceGbp: 7.5,
    allergensPresent: [],
    suitableFor: ["vegetarian"],
    notes: "Provisional placeholder until menu OCR / Atlas data exists.",
  },
  {
    name: "House main (diet-adapted)",
    description: "Kitchen to adapt for stated allergens",
    course: "main",
    priceGbp: 18,
    allergensPresent: [],
    suitableFor: [],
    notes: "Saint will confirm suitability before booking.",
  },
  {
    name: "Seasonal sides",
    description: "Shared for the table",
    course: "side",
    priceGbp: 5,
    allergensPresent: [],
    suitableFor: [],
  },
];

function filterMenu(
  menu: MenuItem[],
  allergens: UkAllergen[],
  preferences: DietaryPreference[]
): MenuItem[] {
  const blocked = new Set(allergens);
  return menu.filter((item) => {
    if (item.allergensPresent.some((a) => blocked.has(a))) return false;
    if (preferences.length === 0) return true;
    return preferences.every((p) => item.suitableFor.includes(p));
  });
}

function pickTemplate(req: RecommendRequest): { items: MenuItem[]; perPersonGbp: number } {
  const prefs = new Set(req.preferences ?? []);
  const food = req.foodType.toLowerCase();
  const allergens = new Set(req.allergens ?? []);

  if (
    prefs.has("vegan") ||
    prefs.has("vegetarian") ||
    food.includes("vegan") ||
    food.includes("vegetarian")
  ) {
    return { items: VEGAN_GF, perPersonGbp: 32 };
  }
  if (
    prefs.has("shellfish_free") ||
    allergens.has("crustaceans") ||
    allergens.has("molluscs") ||
    food.includes("thai") ||
    food.includes("asian") ||
    food.includes("noodle")
  ) {
    return { items: SHELLFISH_SAFE_ASIAN, perPersonGbp: 28 };
  }
  if (prefs.has("coeliac") || prefs.has("gluten_free") || food.includes("gluten")) {
    return { items: COELIAC_BRITISH, perPersonGbp: 38 };
  }
  return { items: DEFAULT_EURO, perPersonGbp: 30 };
}

export function buildProvisionalMenu(req: RecommendRequest): {
  suggestedMenu: SuggestedMenu;
  priceEstimate: PriceEstimate;
} {
  const { items: template, perPersonGbp } = pickTemplate(req);
  const filtered = filterMenu(template, req.allergens ?? [], req.preferences ?? []);
  const items = filtered.length > 0 ? filtered : template.slice(0, 3);

  const prefLabel =
    (req.preferences ?? []).length > 0
      ? (req.preferences ?? []).join(", ")
      : "no special preferences";
  const allergenLabel =
    (req.allergens ?? []).length > 0
      ? (req.allergens ?? []).join(", ")
      : "none listed";

  return {
    suggestedMenu: {
      items,
      notes: `Provisional menu for party of ${req.partySize} (${prefLabel}; avoid: ${allergenLabel}). Not yet verified against this restaurant's menu — confirm before booking. Live OCR + Atlas allergen answers coming next.`,
    },
    priceEstimate: {
      currency: "GBP",
      perPersonGbp,
      totalGbp: Number((perPersonGbp * req.partySize).toFixed(2)),
      includes: "Approximate courses only; excludes drinks & service",
    },
  };
}
