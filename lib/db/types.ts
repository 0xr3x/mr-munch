import type { DietaryPreference, MenuItem, UkAllergen } from "../types.js";

export interface RestaurantDietFlags {
  vegan: "yes" | "only" | "limited" | "no" | "unknown";
  vegetarian: "yes" | "only" | "limited" | "no" | "unknown";
  osmId?: string;
  verifiedAt?: Date;
  source?: "openstreetmap" | "google_types" | "user";
  matchDistanceMeters?: number;
  nameScore?: number;
}

export interface RestaurantDoc {
  placeId: string;
  name: string;
  address: string;
  location: { type: "Point"; coordinates: [number, number] };
  phone?: string;
  website?: string;
  photoUrls?: string[];
  cuisine: string[];
  rating?: number;
  allergenConfidence: "confirmed" | "menu_inferred" | "needs_restaurant_check";
  /** Cross-checked dietary flags (primarily OpenStreetMap diet:* tags) */
  diet?: RestaurantDietFlags;
  updatedAt: Date;
  createdAt: Date;
  sources: string[];
}

export interface DishDoc {
  restaurantPlaceId: string;
  restaurantName: string;
  name: string;
  description: string;
  /** Concatenated text for Atlas Search + Automated Embedding (Voyage) */
  searchText: string;
  course?: MenuItem["course"];
  priceGbp?: number;
  allergensPresent: UkAllergen[];
  suitableFor: DietaryPreference[];
  location: { type: "Point"; coordinates: [number, number] };
  cuisine: string[];
  source: "website_scrape" | "openai_vision" | "user_contribution" | "restaurant_confirmed";
  updatedAt: Date;
  createdAt: Date;
}

export interface AllergenAnswerDoc {
  restaurantPlaceId: string;
  dishName?: string;
  question: string;
  answer: string;
  allergensConfirmed: UkAllergen[];
  /** Never store user identity — shared anonymously */
  anonymous: true;
  createdAt: Date;
}

export interface DietaryProfileDoc {
  /** Saint / user tenant id — private, never shared across tenants */
  tenantId: string;
  allergens: UkAllergen[];
  preferences: DietaryPreference[];
  notes?: string;
  updatedAt: Date;
}
