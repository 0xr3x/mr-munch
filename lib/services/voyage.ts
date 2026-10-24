/**
 * Voyage AI rerank API — used when the Atlas cluster doesn't support the
 * $rerank aggregation stage (it's unknown on MongoDB 8.0).
 */

export function isVoyageConfigured(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

function baseUrl(): string {
  return (process.env.VOYAGE_API_BASE ?? "https://api.voyageai.com/v1").replace(/\/$/, "");
}

/** Returns document indexes ordered from most to least relevant. */
export async function voyageRerank(
  query: string,
  documents: string[],
  topK: number
): Promise<Array<{ index: number; score: number }>> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  if (documents.length === 0) return [];

  const res = await fetch(`${baseUrl()}/rerank`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      documents,
      model: "rerank-2.5",
      top_k: Math.min(topK, documents.length),
    }),
  });

  const data = (await res.json()) as {
    data?: Array<{ index: number; relevance_score: number }>;
    detail?: string;
  };
  if (!res.ok) {
    throw new Error(data.detail ?? `Voyage rerank failed (${res.status})`);
  }
  return (data.data ?? []).map((d) => ({ index: d.index, score: d.relevance_score }));
}
