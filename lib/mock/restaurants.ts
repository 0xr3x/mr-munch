import type {
  DietaryPreference,
  MenuItem,
  RecommendRequest,
  RecommendResponse,
  RestaurantOption,
  UkAllergen,
} from "../types.js";

interface MockVenue {
  id: string;
  name: string;
  cuisine: string[];
  address: string;
  reservationPhone: string;
  rating: number;
  /** Offset from request coords (metres, approximate) */
  offsetMeters: { lat: number; lng: number };
  tags: string[];
  allergenConfidence: RestaurantOption["allergenConfidence"];
  menu: MenuItem[];
  perPersonGbp: number;
}

const MOCK_VENUES: MockVenue[] = [
  {
    id: "rest_borough_green",
    name: "Borough Green Kitchen",
    cuisine: ["modern european", "vegetarian", "vegan"],
    address: "12 Stoney St, London SE1 9AD",
    reservationPhone: "+44 20 7946 0101",
    rating: 4.6,
    offsetMeters: { lat: 180, lng: -90 },
    tags: ["vegan", "vegetarian", "gluten_free", "coeliac", "european"],
    allergenConfidence: "confirmed",
    perPersonGbp: 32,
    menu: [
      {
        name: "Roasted beetroot carpaccio",
        description: "Walnut-free; orange, horseradish cream (oat)",
        course: "starter",
        priceGbp: 9.5,
        allergensPresent: [],
        suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free", "nut_free"],
      },
      {
        name: "Charred cauliflower steak",
        description: "Tahini drizzle on the side; ask for sesame-free",
        course: "main",
        priceGbp: 16.5,
        allergensPresent: ["sesame"],
        suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free"],
        notes: "Sesame can be omitted on request — confirmed by restaurant.",
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
    ],
  },
  {
    id: "rest_soho_noodles",
    name: "Soho Safe Noodles",
    cuisine: ["thai", "asian", "noodles"],
    address: "48 Berwick St, London W1F 8SE",
    reservationPhone: "+44 20 7946 0202",
    rating: 4.4,
    offsetMeters: { lat: -120, lng: 220 },
    tags: ["thai", "asian", "noodles", "shellfish_free", "gluten_free"],
    allergenConfidence: "menu_inferred",
    perPersonGbp: 28,
    menu: [
      {
        name: "Tom yum (veg)",
        description: "Lemongrass, galangal, mushrooms — no fish sauce",
        course: "starter",
        priceGbp: 8,
        allergensPresent: [],
        suitableFor: ["vegan", "vegetarian", "gluten_free", "shellfish_free", "dairy_free"],
      },
      {
        name: "Pad see ew (tofu)",
        description: "Rice noodles, chinese broccoli, gluten-free soy",
        course: "main",
        priceGbp: 14.5,
        allergensPresent: ["soya", "eggs"],
        suitableFor: ["vegetarian", "shellfish_free", "nut_free"],
        notes: "Egg can be omitted for vegan; confirm with kitchen.",
      },
      {
        name: "Crispy morning glory",
        description: "Garlic, chilli",
        course: "side",
        priceGbp: 6,
        allergensPresent: [],
        suitableFor: ["vegan", "vegetarian", "gluten_free", "shellfish_free", "dairy_free", "nut_free"],
      },
      {
        name: "Mango sticky rice",
        description: "Coconut milk",
        course: "dessert",
        priceGbp: 6.5,
        allergensPresent: [],
        suitableFor: ["vegan", "vegetarian", "gluten_free", "dairy_free", "nut_free", "shellfish_free"],
      },
    ],
  },
  {
    id: "rest_fitzrovia_grill",
    name: "Fitzrovia Allergen-Aware Grill",
    cuisine: ["british", "grill", "gluten free"],
    address: "22 Charlotte St, London W1T 2NJ",
    reservationPhone: "+44 20 7946 0303",
    rating: 4.5,
    offsetMeters: { lat: 90, lng: 40 },
    tags: ["british", "grill", "coeliac", "gluten_free", "shellfish_free"],
    allergenConfidence: "confirmed",
    perPersonGbp: 38,
    menu: [
      {
        name: "Celeriac remoulade",
        description: "Apple, mustard seed (ask mustard-free)",
        course: "starter",
        priceGbp: 8.5,
        allergensPresent: ["mustard", "eggs"],
        suitableFor: ["gluten_free", "coeliac", "shellfish_free", "nut_free"],
      },
      {
        name: "Herb-crusted chicken",
        description: "GF crumb, roast roots, jus",
        course: "main",
        priceGbp: 19,
        allergensPresent: [],
        suitableFor: ["gluten_free", "coeliac", "shellfish_free", "nut_free", "dairy_free"],
      },
      {
        name: "Triple-cooked chips",
        description: "Dedicated fryer",
        course: "side",
        priceGbp: 5,
        allergensPresent: [],
        suitableFor: ["vegan", "vegetarian", "gluten_free", "coeliac", "dairy_free", "nut_free", "shellfish_free"],
      },
      {
        name: "Lemon posset",
        description: "Shortbread — GF biscuit available",
        course: "dessert",
        priceGbp: 7,
        allergensPresent: ["milk", "eggs"],
        suitableFor: ["gluten_free", "coeliac", "shellfish_free", "nut_free"],
      },
    ],
  },
];

function metresToDegrees(lat: number, metresNorth: number, metresEast: number) {
  const latOffset = metresNorth / 111_320;
  const lngOffset = metresEast / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { latOffset, lngOffset };
}

function scoreVenue(venue: MockVenue, req: RecommendRequest): number {
  const food = req.foodType.toLowerCase();
  let score = venue.rating * 10;

  if (venue.tags.some((t) => food.includes(t) || t.includes(food))) score += 25;
  if (venue.cuisine.some((c) => food.includes(c) || c.includes(food))) score += 20;

  for (const pref of req.preferences ?? []) {
    if (venue.tags.includes(pref)) score += 12;
  }

  // Prefer venues whose menu items don't list requested allergens
  const blocked = new Set<UkAllergen>(req.allergens ?? []);
  const safeMains = venue.menu.filter(
    (m) =>
      (m.course === "main" || m.course === "starter") &&
      !m.allergensPresent.some((a) => blocked.has(a))
  );
  score += safeMains.length * 5;

  if (venue.allergenConfidence === "confirmed") score += 8;
  return score;
}

function filterMenu(
  menu: MenuItem[],
  allergens: UkAllergen[],
  preferences: DietaryPreference[]
): MenuItem[] {
  const blocked = new Set(allergens);
  return menu.filter((item) => {
    if (item.allergensPresent.some((a) => blocked.has(a))) {
      // Keep if notes say it can be adapted (mock: sesame omit)
      if (item.notes?.toLowerCase().includes("omitted")) return true;
      return false;
    }
    if (preferences.length === 0) return true;
    return preferences.every(
      (p) => item.suitableFor.includes(p) || item.notes?.toLowerCase().includes("confirm")
    );
  });
}

export function buildMockRecommendation(req: RecommendRequest): RecommendResponse {
  const ranked = [...MOCK_VENUES].sort(
    (a, b) => scoreVenue(b, req) - scoreVenue(a, req)
  );
  const best = ranked[0];
  const { latOffset, lngOffset } = metresToDegrees(
    req.latitude,
    best.offsetMeters.lat,
    best.offsetMeters.lng
  );

  const restaurant: RestaurantOption = {
    id: best.id,
    name: best.name,
    cuisine: best.cuisine,
    location: {
      address: best.address,
      latitude: Number((req.latitude + latOffset).toFixed(6)),
      longitude: Number((req.longitude + lngOffset).toFixed(6)),
      placeId: `mock_place_${best.id}`,
    },
    reservationPhone: best.reservationPhone,
    rating: best.rating,
    distanceMeters: Math.round(
      Math.hypot(best.offsetMeters.lat, best.offsetMeters.lng)
    ),
    allergenConfidence: best.allergenConfidence,
  };

  const filtered = filterMenu(
    best.menu,
    req.allergens ?? [],
    req.preferences ?? []
  );
  const items = filtered.length > 0 ? filtered : best.menu.slice(0, 3);

  const perPerson = best.perPersonGbp;
  const total = Number((perPerson * req.partySize).toFixed(2));

  const alternatives = ranked.slice(1, 3).map((v) => {
    const off = metresToDegrees(req.latitude, v.offsetMeters.lat, v.offsetMeters.lng);
    return {
      id: v.id,
      name: v.name,
      cuisine: v.cuisine,
      location: {
        address: v.address,
        latitude: Number((req.latitude + off.latOffset).toFixed(6)),
        longitude: Number((req.longitude + off.lngOffset).toFixed(6)),
        placeId: `mock_place_${v.id}`,
      },
      reservationPhone: v.reservationPhone,
      rating: v.rating,
      distanceMeters: Math.round(Math.hypot(v.offsetMeters.lat, v.offsetMeters.lng)),
      allergenConfidence: v.allergenConfidence,
    } satisfies RestaurantOption;
  });

  const prefLabel =
    (req.preferences ?? []).length > 0
      ? (req.preferences ?? []).join(", ")
      : "no special preferences";
  const allergenLabel =
    (req.allergens ?? []).length > 0
      ? (req.allergens ?? []).join(", ")
      : "none listed";

  return {
    mode: "mock",
    requestEcho: req,
    restaurant,
    suggestedMenu: {
      items,
      notes: `Mock menu tailored for party of ${req.partySize} (${prefLabel}; avoid: ${allergenLabel}). In live mode this is checked against UK's 14 allergens and restaurant-confirmed answers in Atlas.`,
    },
    priceEstimate: {
      currency: "GBP",
      perPersonGbp: perPerson,
      totalGbp: total,
      includes: "Suggested courses for the party; excludes drinks & service",
    },
    alternatives,
    nextSteps: {
      requiresUserConfirmation: true,
      bookingChannel: "saint_agent",
      message: `Ready to ask Saint to call ${restaurant.name} on ${restaurant.reservationPhone} for ${req.partySize} on ${req.dateTime}. Nothing will be sent or booked until you confirm.`,
    },
    meta: {
      generatedAt: new Date().toISOString(),
      sources: ["mock_catalog"],
    },
  };
}
