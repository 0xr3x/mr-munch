/** UK's 14 major allergens (Food Standards Agency) */
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
  | "nuts"
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

export interface RecommendRequest {
  /** WGS84 latitude */
  latitude: number;
  /** WGS84 longitude */
  longitude: number;
  /** Cuisine or food style, e.g. "italian", "thai", "modern european" */
  foodType: string;
  /** Party size */
  partySize: number;
  /** UK allergens to avoid */
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
  allergensPresent: UkAllergen[];
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
  /** Google / site photo URLs used for menu OCR */
  photoUrls?: string[];
  reservationPhone: string;
  rating?: number;
  distanceMeters?: number;
  allergenConfidence: "confirmed" | "menu_inferred" | "needs_restaurant_check";
  /** How many scraped dishes looked suitable for the party */
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
    photoUrls: string[];
    method: string[];
  };
  meta: {
    generatedAt: string;
    sources: string[];
  };
}
