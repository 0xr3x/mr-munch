import type { DietaryPreference, UkAllergen } from "../types.js";

/** Keyword → UK 14 allergen (Food Standards Agency). */
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
    "flour",
    "soy wheat",
    "plant [wheat]",
    "wheat flour",
    "wheat protein",
    "wheat batter",
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
  nuts: [
    "almond",
    "hazelnut",
    "walnut",
    "cashew",
    "pecan",
    "pistachio",
    "macadamia",
    "brazil nut",
    " treenut",
    "tree nut",
    "nuts",
    " nut",
    "nut ",
  ],
  peanuts: ["peanut", "groundnut", "satay"],
  sesame: ["sesame", "tahini", "benne"],
  soya: ["soya", "soy", "tofu", "edamame", "tempeh", "miso"],
  sulphur_dioxide: ["sulphite", "sulfite", "sulphur dioxide", "sulfur dioxide"],
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
  "ribs",
];

export function detectAllergensInText(text: string): UkAllergen[] {
  // Mask coconut* so it does not match tree-nut keywords
  const lower = ` ${text.toLowerCase().replace(/coconut/g, "coco_nut_safe")} `;
  const found = new Set<UkAllergen>();

  for (const [allergen, keywords] of Object.entries(ALLERGEN_KEYWORDS) as [
    UkAllergen,
    string[],
  ][]) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        // Avoid vegan "fish cake" / "prawn cracker" false positives when marked vegan chay
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
        found.add(allergen);
        break;
      }
    }
  }
  return [...found];
}

export function preferenceConflicts(
  text: string,
  preferences: DietaryPreference[],
  allergensPresent: UkAllergen[]
): DietaryPreference[] {
  const lower = ` ${text.toLowerCase()} `;
  const markedVegan = /\bvegan\b|\bplant[- ]based\b|\bchay\b/.test(lower);
  const conflicts: DietaryPreference[] = [];

  for (const pref of preferences) {
    switch (pref) {
      case "vegan":
        if (markedVegan) break;
        if (
          allergensPresent.some((a) =>
            ["milk", "eggs", "fish", "crustaceans", "molluscs"].includes(a)
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
            allergensPresent.some((a) =>
              ["fish", "crustaceans", "molluscs"].includes(a)
            ))
        ) {
          conflicts.push(pref);
        }
        break;
      case "gluten_free":
      case "coeliac":
        if (allergensPresent.includes("cereals_containing_gluten")) {
          conflicts.push(pref);
        }
        break;
      case "dairy_free":
        if (allergensPresent.includes("milk")) conflicts.push(pref);
        break;
      case "nut_free":
        if (
          allergensPresent.includes("nuts") ||
          allergensPresent.includes("peanuts")
        ) {
          conflicts.push(pref);
        }
        break;
      case "shellfish_free":
        if (
          allergensPresent.includes("crustaceans") ||
          allergensPresent.includes("molluscs")
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

export function dishMatchesRestrictions(
  text: string,
  avoidAllergens: UkAllergen[],
  preferences: DietaryPreference[]
): { ok: boolean; allergensPresent: UkAllergen[]; preferenceConflicts: DietaryPreference[] } {
  const allergensPresent = detectAllergensInText(text);
  const blocked = avoidAllergens.filter((a) => allergensPresent.includes(a));
  const prefs = preferenceConflicts(text, preferences, allergensPresent);
  return {
    ok: blocked.length === 0 && prefs.length === 0,
    allergensPresent,
    preferenceConflicts: prefs,
  };
}
