import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { chatJson, llmAvailable } from "@/lib/llm/client";
import { keyPhrasesSystemPrompt, visualsSystemPrompt } from "@/lib/llm/prompts";
import { absPath, projectDir, relPath } from "@/lib/storage";
import type { CaptionWord, Visual } from "@/lib/types";
import { ffmpeg } from "@/lib/media/ffmpeg";

// Auto-sourced B-roll: chunk the (post-cut) transcript, extract the concept
// discussed in each chunk, search the web for an image, and pin it to the
// chunk's timestamps. Every step is replaceable by the user in the UI.

export interface ImageResult {
  url: string;
  thumb: string;
  source: string;
  credit?: string;
  width?: number;
  height?: number;
}

const CHUNK_TARGET_SEC = 5;
const CHUNK_MIN_SEC = 3;

export interface Chunk {
  index: number;
  start: number;
  end: number;
  text: string;
}

export function chunkCaptions(words: CaptionWord[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      index: chunks.length,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(" "),
    });
    cur = [];
  };
  for (const w of words) {
    cur.push(w);
    const span = w.end - cur[0].start;
    const sentenceEnd = /[.!?]["')\]]*$/.test(w.text);
    if (span >= CHUNK_TARGET_SEC || (sentenceEnd && span >= CHUNK_MIN_SEC)) flush();
  }
  flush();
  // merge a trailing runt into the previous chunk
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (last.end - last.start < 1.5) {
      const prev = chunks[chunks.length - 2];
      prev.end = last.end;
      prev.text += " " + last.text;
      chunks.pop();
    }
  }
  return chunks;
}

export async function conceptQueries(chunks: Chunk[], niche: string | null): Promise<Array<{ concept: string; query: string }>> {
  if (llmAvailable()) {
    try {
      const data = await chatJson<{ queries?: Array<{ index: number; concept?: string; query?: string }> }>(
        [
          { role: "system", content: visualsSystemPrompt() + (niche ? `\nThe creator's niche is "${niche}".` : "") },
          {
            role: "user",
            content: chunks.map((c) => `[${c.index}] (${c.start.toFixed(1)}s-${c.end.toFixed(1)}s) ${c.text}`).join("\n"),
          },
        ],
        { temperature: 0.3 },
      );
      const byIndex = new Map((data.queries || []).map((q) => [Number(q.index), q]));
      return chunks.map((c) => {
        const q = byIndex.get(c.index);
        const query = (q?.query || "").trim();
        return query ? { concept: (q?.concept || query).trim(), query } : heuristicQuery(c.text, niche);
      });
    } catch (err) {
      console.warn("LLM concept extraction failed, using heuristics:", err);
    }
  }
  return chunks.map((c) => heuristicQuery(c.text, niche));
}

const STOP = new Set(
  "the a an and or but if then so of to in on at for with by from as is are was were be been being this that these those it its i you we they he she them us our your my me his her their what which who whom when where why how not no yes do does did done have has had can could should would will just like about into over under than too very really here there now today all any some more most other such only own same up down out off again further once because while during before after above below between through".split(
    " ",
  ),
);

export function heuristicQuery(text: string, niche: string | null): { concept: string; query: string } {
  const raw = text.replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/).filter(Boolean);
  // Proper nouns / product names (capitalised mid-sentence or containing digits)
  const proper: string[] = [];
  const rawWithPunct = text.split(/\s+/).filter(Boolean);
  const sentenceStart = (i: number) => i === 0 || /[.!?]["')\]]*$/.test(rawWithPunct[i - 1] || "");
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    const isProper = (/^[A-Z][\w-]*$/.test(w) && !sentenceStart(i)) || /\d/.test(w) || /^[A-Z]{2,}/.test(w);
    if (isProper && !STOP.has(w.toLowerCase()) && w.length > 1) {
      // extend multi-word names ("Tesla Model", "New York")
      let phrase = w;
      while (i + 1 < raw.length && /^[A-Z][\w-]*$/.test(raw[i + 1]) && !STOP.has(raw[i + 1].toLowerCase())) {
        phrase += " " + raw[++i];
      }
      proper.push(phrase);
    }
  }
  if (proper.length) return { concept: proper[0], query: proper[0] };
  // Otherwise the longest content words
  const content = raw.map((w) => w.toLowerCase()).filter((w) => w.length > 3 && !STOP.has(w));
  const freq = new Map<string, number>();
  for (const w of content) freq.set(w, (freq.get(w) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, 2).map((e) => e[0]);
  const query = top.join(" ") || niche || "abstract background";
  return { concept: query, query };
}

// ---------- Image search providers ----------

export async function searchImages(query: string, limit = 6): Promise<ImageResult[]> {
  const providers: Array<() => Promise<ImageResult[]>> = [];
  if (env.images.googleKey && env.images.googleCx) providers.push(() => googleImages(query, limit));
  if (env.images.pexels) providers.push(() => pexels(query, limit));
  if (env.images.unsplash) providers.push(() => unsplash(query, limit));
  providers.push(() => wikipedia(query, limit));
  providers.push(() => openverse(query, limit));
  const results: ImageResult[] = [];
  for (const p of providers) {
    try {
      const r = await p();
      results.push(...r);
      if (results.length >= limit) break;
    } catch (err) {
      console.warn(`image search provider failed for "${query}":`, err instanceof Error ? err.message : err);
    }
  }
  return results.slice(0, limit);
}

async function googleImages(query: string, limit: number): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    key: env.images.googleKey,
    cx: env.images.googleCx,
    q: query,
    searchType: "image",
    num: String(Math.min(10, limit)),
    safe: "active",
    imgSize: "large",
  });
  const res = await fetch(`https://www.googleapis.com/customsearch/v1?${params}`);
  if (!res.ok) throw new Error(`google ${res.status}`);
  const data = (await res.json()) as { items?: Array<{ link: string; image?: { thumbnailLink?: string; width?: number; height?: number }; displayLink?: string }> };
  return (data.items || []).map((i) => ({
    url: i.link,
    thumb: i.image?.thumbnailLink || i.link,
    source: "google",
    credit: i.displayLink,
    width: i.image?.width,
    height: i.image?.height,
  }));
}

async function pexels(query: string, limit: number): Promise<ImageResult[]> {
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=landscape`, {
    headers: { Authorization: env.images.pexels },
  });
  if (!res.ok) throw new Error(`pexels ${res.status}`);
  const data = (await res.json()) as { photos?: Array<{ src: { large2x: string; medium: string }; photographer: string; width: number; height: number }> };
  return (data.photos || []).map((p) => ({ url: p.src.large2x, thumb: p.src.medium, source: "pexels", credit: p.photographer, width: p.width, height: p.height }));
}

async function unsplash(query: string, limit: number): Promise<ImageResult[]> {
  const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${limit}`, {
    headers: { Authorization: `Client-ID ${env.images.unsplash}` },
  });
  if (!res.ok) throw new Error(`unsplash ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ urls: { regular: string; small: string }; user: { name: string }; width: number; height: number }> };
  return (data.results || []).map((p) => ({ url: p.urls.regular, thumb: p.urls.small, source: "unsplash", credit: p.user.name, width: p.width, height: p.height }));
}

async function wikipedia(query: string, limit: number): Promise<ImageResult[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(Math.min(10, limit + 2)),
    prop: "pageimages",
    piprop: "original|thumbnail",
    pithumbsize: "400",
    format: "json",
    origin: "*",
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": "Viralyzer/1.0 (creator video tool)" },
  });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const data = (await res.json()) as {
    query?: { pages?: Record<string, { title: string; index: number; original?: { source: string; width: number; height: number }; thumbnail?: { source: string } }> };
  };
  const pages = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index);
  return pages
    .filter((p) => p.original?.source && !/\.svg$/i.test(p.original.source))
    .map((p) => ({
      url: p.original!.source,
      thumb: p.thumbnail?.source || p.original!.source,
      source: "wikipedia",
      credit: `Wikipedia: ${p.title}`,
      width: p.original!.width,
      height: p.original!.height,
    }));
}

async function openverse(query: string, limit: number): Promise<ImageResult[]> {
  const params = new URLSearchParams({ q: query, page_size: String(limit), mature: "false" });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { "User-Agent": "Viralyzer/1.0" },
  });
  if (!res.ok) throw new Error(`openverse ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ url: string; thumbnail?: string; creator?: string; width?: number; height?: number }> };
  return (data.results || []).map((r) => ({ url: r.url, thumb: r.thumbnail || r.url, source: "openverse", credit: r.creator, width: r.width, height: r.height }));
}

// ---------- Download + normalise ----------

/** Download a remote image into the project folder and convert to a 1280px-wide JPEG for ffmpeg. */
export async function cacheImage(projectId: string, url: string): Promise<string> {
  const dir = projectDir(projectId, "visuals");
  const id = newId("img");
  const rawPath = path.join(dir, `${id}.raw`);
  const outPath = path.join(dir, `${id}.jpg`);
  const res = await fetch(url, { headers: { "User-Agent": "Viralyzer/1.0 (creator video tool)", Accept: "image/*" } });
  if (!res.ok) throw new Error(`image download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 200) throw new Error("image download returned an empty file");
  fs.writeFileSync(rawPath, buf);
  try {
    await ffmpeg(["-i", rawPath, "-vf", "scale='min(1280,iw)':-2", "-frames:v", "1", "-update", "1", "-q:v", "3", outPath]);
  } finally {
    fs.rmSync(rawPath, { force: true });
  }
  return relPath(outPath);
}

export async function autoSourceVisuals(
  projectId: string,
  captions: CaptionWord[],
  niche: string | null,
  onProgress?: (f: number, msg: string) => void,
): Promise<Visual[]> {
  const chunks = chunkCaptions(captions);
  if (!chunks.length) return [];
  onProgress?.(0.05, "Extracting concepts");
  const queries = await conceptQueries(chunks, niche);
  const visuals: Visual[] = [];
  let lastGood: { url: string; file: string; source: string; credit?: string } | null = null;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const q = queries[i];
    onProgress?.(0.1 + (0.85 * i) / chunks.length, `Finding image for "${q.query}"`);
    let picked: ImageResult | null = null;
    let file: string | null = null;
    try {
      const results = await searchImages(q.query, 4);
      for (const r of results) {
        try {
          file = await cacheImage(projectId, r.url);
          picked = r;
          break;
        } catch {
          /* try next */
        }
      }
    } catch (err) {
      console.warn("visual search failed", err);
    }
    if (picked && file) lastGood = { url: picked.url, file, source: picked.source, credit: picked.credit };
    visuals.push({
      id: newId("v"),
      start: c.start,
      end: c.end,
      query: q.query,
      concept: q.concept,
      imageUrl: picked?.url ?? lastGood?.url ?? null,
      file: file ?? lastGood?.file ?? null,
      source: picked?.source ?? lastGood?.source,
      credit: picked?.credit ?? lastGood?.credit,
    });
  }
  // Extend the last visual to the end of the video.
  return visuals;
}

export async function extractKeyPhrases(captions: CaptionWord[]): Promise<string[]> {
  const text = captions.map((w) => w.text).join(" ");
  if (!text.trim()) return [];
  if (llmAvailable()) {
    try {
      const data = await chatJson<{ phrases?: string[] }>(
        [
          { role: "system", content: keyPhrasesSystemPrompt() },
          { role: "user", content: text },
        ],
        { temperature: 0.3 },
      );
      const phrases = (data.phrases || []).map((p) => String(p).trim()).filter((p) => p && p.split(/\s+/).length <= 5);
      if (phrases.length) return phrases.slice(0, 8);
    } catch (err) {
      console.warn("key phrase extraction failed", err);
    }
  }
  // Heuristic: numbers, proper nouns, and the first sentence's punchiest words
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out = new Set<string>();
  for (const s of sentences) {
    // numbers, and capitalised words that are not simply the start of the sentence
    const rest = s.replace(/^\S+\s*/, "");
    const m = [...(s.match(/(?<![\w-])\d[\d,.]*(?:[%$kKmMxX]|\s(?:percent|million|billion|thousand|days|years|hours|minutes|seconds))?/g) || []), ...(rest.match(/\b[A-Z][\w-]+(?:\s[A-Z][\w-]+)?\b/g) || [])];
    for (const x of m) if (x.length > 2 && !STOP.has(x.toLowerCase())) out.add(x.replace(/[.,]$/, ""));
    if (out.size >= 8) break;
  }
  // The hook (first sentence) is always worth a pop: take its first 3-4 words.
  const hook = (sentences[0] || "").replace(/[^\p{L}\p{N}\s'-]/gu, "").split(/\s+/).slice(0, 4).join(" ");
  if (hook && out.size < 8) out.add(hook);
  if (out.size < 3) {
    const words = text.split(/\s+/).filter((w) => w.length > 6 && !STOP.has(w.toLowerCase()));
    for (const w of words.slice(0, 6)) out.add(w.replace(/[^\w'-]/g, ""));
  }
  return [...out].slice(0, 8);
}

export function visualExists(v: Visual): boolean {
  return !!v.file && fs.existsSync(absPath(v.file));
}
