import type { VercelResponse } from "@vercel/node";

export function cors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function json(
  res: VercelResponse,
  status: number,
  body: unknown
): VercelResponse {
  cors(res);
  if (status === 204) {
    return res.status(204).end();
  }
  return res.status(status).json(body);
}

export function methodNotAllowed(
  res: VercelResponse,
  allowed: string[]
): VercelResponse {
  res.setHeader("Allow", allowed.join(", "));
  return json(res, 405, {
    error: "method_not_allowed",
    message: `Use ${allowed.join(" or ")}`,
  });
}
