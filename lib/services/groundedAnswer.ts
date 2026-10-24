/**
 * RAG step: write the final recommendation from dishes retrieved out of Atlas
 * (hybrid search + Voyage rerank), so the LLM only talks about what we know.
 */

import type { DietaryPreference, GroundedAnswer, UkAllergen } from "../types.js";

export interface GroundingDish {
  name: string;
  description: string;
  allergensPresent: UkAllergen[];
  source?: string;
}

export interface GroundedAnswerInput {
  restaurant: {
    name: string;
    distanceMeters?: number;
    allergenConfidence: string;
    osmVegan?: string;
  };
  party: {
    partySize: number;
    foodType: string;
    allergens: UkAllergen[];
    preferences: DietaryPreference[];
  };
  dishes: GroundingDish[];
  retrieval: GroundedAnswer["retrieval"];
}

const SYSTEM = `You are Mr Munch, a dining concierge for people with food allergies and diets.
Write a short recommendation for ONE restaurant using ONLY the dishes and facts given. They come from our database; do not add dishes, ingredients or facts.
Rules:
- Never say a dish is "safe" or "allergen-free". The most you may say is that no listed allergens were found on the menu.
- For each of the party's allergens or diets the menu cannot rule out, add a short question for the kitchen.
- dishesToTry names must be copied exactly from the list.
Return ONLY valid JSON: {"summary": string (max 2 sentences), "dishesToTry": [{"name": string, "why": string}] (max 4), "askTheKitchen": string[] (max 3)}`;

function model(): string {
  return process.env.OPENAI_ANSWER_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
}

export async function generateGroundedAnswer(
  input: GroundedAnswerInput
): Promise<GroundedAnswer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const context = {
    restaurant: input.restaurant,
    party: input.party,
    dishes: input.dishes.map((d) => ({
      name: d.name,
      description: d.description,
      allergensPresent: d.allergensPresent,
    })),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      temperature: 0.2,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(context) },
      ],
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? `OpenAI error ${res.status}`);
  }

  let parsed: {
    summary?: string;
    dishesToTry?: Array<{ name?: string; why?: string }>;
    askTheKitchen?: string[];
  };
  try {
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } catch {
    parsed = {};
  }

  // Grounding guard: drop any dish the model named that Atlas didn't return
  const known = new Map(input.dishes.map((d) => [d.name.toLowerCase(), d.name]));
  const dishesToTry = (parsed.dishesToTry ?? [])
    .filter((d) => d.name && known.has(d.name.toLowerCase()))
    .slice(0, 4)
    .map((d) => ({ name: known.get(d.name!.toLowerCase())!, why: d.why ?? "" }));

  return {
    summary: parsed.summary ?? "",
    dishesToTry,
    askTheKitchen: (parsed.askTheKitchen ?? []).slice(0, 3),
    retrieval: input.retrieval,
    model: model(),
  };
}
