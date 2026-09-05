import { NextRequest } from "next/server";
import { badRequest, json } from "@/lib/http";
import { searchImages } from "@/lib/editing/visuals";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) return badRequest("Missing query");
  const results = await searchImages(q, 12);
  return json({ results });
}
