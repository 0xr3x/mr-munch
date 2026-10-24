/**
 * OpenAI — parse menus from website text and/or menu photos / specials boards.
 */

import { normalizeAllergenList } from "../allergens/lexicon.js";

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export interface MenuVisionDish {
  name: string;
  description?: string;
  priceGbp?: number;
  allergensSuspected: string[];
}

export interface MenuVisionResult {
  dishes: MenuVisionDish[];
  rawText: string;
}

const SYSTEM = `You extract restaurant menu dishes for UK allergen checking.
Return ONLY valid JSON: {"dishes":[{"name":string,"description":string,"priceGbp":number|null,"allergensSuspected":string[]}]}
allergensSuspected must use only these ids when relevant:
celery, cereals_containing_gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, tree_nuts, peanuts, sesame, soya, sulphur_dioxide.
Use tree_nuts for almond/cashew/walnut/hazelnut/pistachio/pecan/macadamia/brazil (NOT peanuts).
Flag cereals_containing_gluten when wheat/barley/rye/batter/soy sauce/BBQ glaze/crispy coating is likely.
If unsure, include the allergen. Prefer fewer high-quality dishes (max 20).`;

async function chatJson(
  userContent: Array<Record<string, unknown>>
): Promise<MenuVisionResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
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

  const rawText = data.choices?.[0]?.message?.content ?? "{}";
  let parsed: { dishes?: MenuVisionDish[] };
  try {
    parsed = JSON.parse(rawText) as { dishes?: MenuVisionDish[] };
  } catch {
    parsed = { dishes: [] };
  }

  return {
    dishes: (parsed.dishes ?? []).map((d) => ({
      name: d.name,
      description: d.description,
      priceGbp: d.priceGbp ?? undefined,
      allergensSuspected: normalizeAllergenList(d.allergensSuspected ?? []),
    })),
    rawText,
  };
}

export async function recogniseMenuFromText(
  menuText: string
): Promise<MenuVisionResult> {
  return chatJson([
    {
      type: "text",
      text: `Extract dishes and suspected UK allergens from this restaurant page text:\n\n${menuText}`,
    },
  ]);
}

export async function recogniseMenuFromImage(
  imageUrlOrBase64: string
): Promise<MenuVisionResult> {
  const isUrl = /^https?:\/\//i.test(imageUrlOrBase64);
  const imageUrl = isUrl
    ? imageUrlOrBase64
    : `data:image/jpeg;base64,${imageUrlOrBase64.replace(/^data:[^;]+;base64,/, "")}`;

  return chatJson([
    {
      type: "text",
      text: "Read this menu photo / specials board. Extract dishes, prices if visible, and suspected UK allergens.",
    },
    {
      type: "image_url",
      image_url: { url: imageUrl },
    },
  ]);
}
