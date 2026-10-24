/**
 * Fetch restaurant pages as LLM-ready markdown.
 * Uses Jina Reader by default (bypasses many Cloudflare blocks that break raw fetch).
 */

const DEFAULT_READER = "https://r.jina.ai/";

function readerBase(): string {
  return process.env.WEB_READER_BASE?.replace(/\/?$/, "/") ?? DEFAULT_READER;
}

export async function fetchPageMarkdown(
  url: string,
  timeoutMs = 12_000
): Promise<{ url: string; markdown: string; ok: boolean }> {
  const target = url.startsWith("http") ? url : `https://${url}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${readerBase()}${target}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "User-Agent": "MrMunch/0.1 (dining-concierge; allergen-check)",
      },
    });
    const markdown = await res.text();
    const blocked =
      !res.ok ||
      markdown.includes("SubmittedDataMalformedError") ||
      markdown.includes("Sorry, you have been blocked") ||
      markdown.length < 80;
    return { url: target, markdown: blocked ? "" : markdown, ok: !blocked };
  } catch {
    return { url: target, markdown: "", ok: false };
  } finally {
    clearTimeout(timer);
  }
}

const MENU_HREF =
  /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi;

export function extractMenuCandidateUrls(
  markdown: string,
  baseUrl: string
): string[] {
  const urls = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(MENU_HREF.source, "gi");
  while ((match = re.exec(markdown)) !== null) {
    const label = (match[1] ?? "").toLowerCase();
    const href = match[2];
    if (
      /menu|food|allergen|dietary|dish|eat|order/.test(label) ||
      /menu|allergen|food-menu|our-food/.test(href.toLowerCase())
    ) {
      urls.add(href.split("#")[0]);
    }
  }

  // Common menu paths relative to homepage
  try {
    const base = new URL(baseUrl);
    for (const path of ["/menu", "/menus", "/food", "/our-menu", "/order", "/order-now"]) {
      urls.add(new URL(path, base).toString());
    }
  } catch {
    /* ignore */
  }

  return [...urls].slice(0, 4);
}

export function extractImageUrls(markdown: string, limit = 8): string[] {
  const urls: string[] = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const u = match[1];
    if (/\.(jpg|jpeg|png|webp)/i.test(u) || /upload|media|image/i.test(u)) {
      urls.push(u);
    }
    if (urls.length >= limit) break;
  }
  return [...new Set(urls)];
}
