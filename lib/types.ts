/** UK's 14 major allergens (Food Standards Agency). Tree nuts = tree_nuts (not peanuts). */
export type UkAllergen =
  | "celery"
  | "cereals_containing_gluten"
  | "crustaceans"
  | "eggs"
  | "fish"
  | "lupin"
  | "milk"
  | "molluscs"
  | "mustard"
  | "tree_nuts"
  | "peanuts"
  | "sesame"
  | "soya"
  | "sulphur_dioxide";

export type DietaryPreference =
  | "vegan"
  | "vegetarian"
  | "pescatarian"
  | "halal"
  | "kosher"
  | "coeliac"
  | "dairy_free"
  | "gluten_free"
  | "nut_free"
  | "shellfish_free";

/** Confidence ladder (low → high trust for UI). */
export type AllergenConfidence =
  | "needs_restaurant_check"
  | "website_text"
  | "menu_inferred"
  | "kitchen_confirmed";

export type AllergenVerdict = "clear" | "present" | "unknown";

export interface AllergenCheck {
  allergen: UkAllergen;
  status: AllergenVerdict;
  source:
    | "menu_text"
    | "inferred_risk"
    | "explicit_free_from"
    | "not_mentioned";
  evidence?: string;
}

export interface RecommendRequest {
  /** WGS84 latitude */
  latitude: number;
  /** WGS84 longitude */
  longitude: number;
  /** Cuisine or food style, e.g. "italian", "thai", "modern european" */
  foodType: string;
  /** Party size */
  partySize: number;
  /** UK allergens to avoid (use tree_nuts + peanuts; "nuts" accepted as tree_nuts) */
  allergens?: UkAllergen[];
  /** Broader dietary preferences */
  preferences?: DietaryPreference[];
  /** ISO 8601 date-time for the booking */
  dateTime: string;
  /** Optional search radius in metres (default 2000) */
  radiusMeters?: number;
}

export interface MenuItem {
  name: string;
  description: string;
  course: "starter" | "main" | "side" | "dessert" | "drink";
  priceGbp: number;
  /** Allergens with positive keyword evidence */
  allergensPresent: UkAllergen[];
  /** Per-allergen status for party restrictions — clear / present / unknown */
  allergenChecks?: AllergenCheck[];
  /** Only preferences positively supported (never a soft "looks fine" tick) */
  suitableFor: DietaryPreference[];
  notes?: string;
}

export interface RestaurantOption {
  id: string;
  name: string;
  cuisine: string[];
  location: {
    address: string;
    latitude: number;
    longitude: number;
    placeId?: string;
  };
  /** Official website from Google Places (when available) */
  website?: string;
  /**
   * Google Places photos (when used). Prefer menuPhotoUrls / siteImageUrls
   * — do not treat marketing assets as menu OCR evidence.
   */
  photoUrls?: string[];
  /** Images that look like menu / specials boards */
  menuPhotoUrls?: string[];
  /** Other site assets (logo, dish marketing shots) — not menu evidence */
  siteImageUrls?: string[];
  reservationPhone: string;
  rating?: number;
  distanceMeters?: number;
  allergenConfidence: AllergenConfidence;
  /** How many scraped dishes passed hard checks for the party */
  suitableDishCount?: number;
  menuPagesFetched?: string[];
  /** OpenStreetMap diet:* cross-check (after Google) */
  diet?: {
    vegan: "yes" | "only" | "limited" | "no" | "unknown";
    vegetarian: "yes" | "only" | "limited" | "no" | "unknown";
    osmId?: string;
    source?: string;
    matchDistanceMeters?: number;
    nameScore?: number;
  };
}

export interface SuggestedMenu {
  items: MenuItem[];
  notes: string;
}

export interface PriceEstimate {
  currency: "GBP";
  perPersonGbp: number;
  totalGbp: number;
  includes: string;
}

export interface RecommendResponse {
  mode: "mock" | "live";
  requestEcho: RecommendRequest;
  restaurant: RestaurantOption;
  suggestedMenu: SuggestedMenu;
  priceEstimate: PriceEstimate;
  alternatives?: RestaurantOption[];
  nextSteps: {
    requiresUserConfirmation: boolean;
    bookingChannel: "saint_agent" | "phone" | "none";
    message: string;
  };
  menuAnalysis?: {
    dishesParsed: number;
    suitableDishes: number;
    pagesFetched: string[];
    /** @deprecated use menuPhotoUrls / siteImageUrls */
    photoUrls: string[];
    menuPhotoUrls: string[];
    siteImageUrls: string[];
    method: string[];
    atlasDishesBeforeScrape?: number;
    dishesUpsertedThisRun?: number;
  };
  meta: {
    generatedAt: string;
    sources: string[];
  };
}
