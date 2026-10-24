/**
 * MongoDB Atlas client — multitenancy (dietary profiles) + shared restaurant knowledge.
 * Search: Atlas Search + Vector Search (Voyage autoEmbed) + hybrid $rankFusion + $rerank.
 */

import { MongoClient, type Collection, type Db, type Document } from "mongodb";
import type {
  AllergenAnswerDoc,
  DietaryProfileDoc,
  DishDoc,
  RestaurantDoc,
} from "../db/types.js";

let client: MongoClient | null = null;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  if (!client) {
    client = new MongoClient(uri, {
      // Serverless-friendly: small pool, fail fast, stable TLS to Atlas
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 10_000,
      serverSelectionTimeoutMS: 12_000,
      connectTimeoutMS: 12_000,
    });
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB ?? "mrmunch");
}

export const Collections = {
  users: "users",
  dietaryProfiles: "dietary_profiles",
  restaurants: "restaurants",
  dishes: "dishes",
  menus: "menus",
  menuContributions: "menu_contributions",
  allergenAnswers: "allergen_answers_anonymous",
  streamEvents: "stream_events",
} as const;

export async function restaurantsCol(): Promise<Collection<RestaurantDoc>> {
  return (await getDb()).collection(Collections.restaurants);
}

export async function dishesCol(): Promise<Collection<DishDoc>> {
  return (await getDb()).collection(Collections.dishes);
}

export async function allergenAnswersCol(): Promise<Collection<AllergenAnswerDoc>> {
  return (await getDb()).collection(Collections.allergenAnswers);
}

export async function dietaryProfilesCol(): Promise<Collection<DietaryProfileDoc>> {
  return (await getDb()).collection(Collections.dietaryProfiles);
}

export async function menuContributionsCol(): Promise<Collection<Document>> {
  return (await getDb()).collection(Collections.menuContributions);
}

/** Regular indexes (not Search/Vector — those are created via Atlas UI or bootstrap). */
export async function ensureDataIndexes(): Promise<string[]> {
  const created: string[] = [];
  const restaurants = await restaurantsCol();
  const dishes = await dishesCol();
  const profiles = await dietaryProfilesCol();

  await restaurants.createIndex({ placeId: 1 }, { unique: true });
  created.push("restaurants.placeId");
  await restaurants.createIndex({ location: "2dsphere" });
  created.push("restaurants.location_2dsphere");

  await dishes.createIndex(
    { restaurantPlaceId: 1, name: 1 },
    { unique: true }
  );
  created.push("dishes.restaurantPlaceId_name");
  await dishes.createIndex({ location: "2dsphere" });
  created.push("dishes.location_2dsphere");
  await dishes.createIndex({ allergensPresent: 1 });
  created.push("dishes.allergensPresent");

  await profiles.createIndex({ tenantId: 1 }, { unique: true });
  created.push("dietary_profiles.tenantId");

  return created;
}
