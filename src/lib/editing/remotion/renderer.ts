import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { ffmpeg } from "@/lib/media/ffmpeg";
import type { EditCompositionProps } from "../../../../remotion/props";

// Server-side Remotion rendering. The compositions live in /remotion; they are
// bundled once (cached by content hash) and rendered with a headless Chrome.
// Remotion produces the picture only; the cleaned audio is muxed back with
// ffmpeg so loudness and sync stay exactly what the cleanup pass produced.

export const REMOTION_DIR = path.join(process.cwd(), "remotion");

export interface RemotionCapability {
  ok: boolean;
  reason: string | null;
  browser: string | null;
}

function findBrowser(): string | null {
  const envPath = process.env.REMOTION_BROWSER_EXECUTABLE || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  // Remotion's own download cache
  const cache = path.join(process.cwd(), "node_modules", ".remotion", "chrome-headless-shell");
  try {
    for (const dir of fs.readdirSync(cache)) {
      for (const name of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
        const cand = path.join(cache, dir, name);
        if (fs.existsSync(cand)) return cand;
        const nested = path.join(cache, dir, "chrome-headless-shell-linux64", name);
        if (fs.existsSync(nested)) return nested;
      }
    }
  } catch {
    /* no cache */
  }
  // Playwright / system browsers
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH || "", "/opt/pw-browsers", path.join(os.homedir(), ".cache", "ms-playwright")].filter(Boolean);
  for (const root of roots) {
    try {
      for (const dir of fs.readdirSync(root)) {
        for (const rel of ["chrome-linux/headless_shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) {
          const cand = path.join(root, dir, rel);
          if (fs.existsSync(cand)) return cand;
        }
      }
    } catch {
      /* skip */
    }
  }
  for (const cand of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

let capCache: RemotionCapability | null = null;

export function remotionCapability(): RemotionCapability {
  if (capCache?.ok) return capCache;
  if (process.env.REMOTION_DISABLE === "1") return { ok: false, reason: "Remotion disabled with REMOTION_DISABLE=1", browser: null };
  if (!fs.existsSync(path.join(REMOTION_DIR, "index.ts"))) return { ok: false, reason: "remotion/ compositions are missing from this deployment", browser: null };
  try {
    require.resolve("@remotion/renderer");
  } catch {
    return { ok: false, reason: "@remotion/renderer is not installed", browser: null };
  }
  const browser = findBrowser();
  if (!browser) {
    return {
      ok: false,
      reason: "No headless Chrome found. Run `npx remotion browser ensure` (downloads Chrome Headless Shell) or set REMOTION_BROWSER_EXECUTABLE.",
      browser: null,
    };
  }
  return (capCache = { ok: true, reason: null, browser });
}

// ---------- bundle cache ----------

function hashDir(dir: string): string {
  const h = createHash("sha1");
  const walk = (d: string) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        // Content hash (not mtime) so a bundle built in a Docker build stage is reused at runtime.
        h.update(p.slice(dir.length));
        h.update(fs.readFileSync(p));
      }
    }
  };
  walk(dir);
  try {
    h.update(fs.readFileSync(path.join(process.cwd(), "node_modules", "remotion", "package.json")));
  } catch {
    /* ignore */
  }
  return h.digest("hex").slice(0, 12);
}

let bundlePromise: Promise<string> | null = null;

/** Bundle the compositions once per content hash; returns the serve directory. */
export async function ensureBundle(onProgress?: (msg: string) => void): Promise<string> {
  const root = process.env.REMOTION_BUNDLE_DIR || path.join(env.dataDir, "remotion-bundle");
  const hash = hashDir(REMOTION_DIR);
  const dir = path.join(root, hash);
  if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    onProgress?.("Bundling Remotion compositions (first time only)");
    const { bundle } = await import("@remotion/bundler");
    fs.mkdirSync(root, { recursive: true });
    await bundle({
      entryPoint: path.join(REMOTION_DIR, "index.ts"),
      outDir: dir,
      publicDir: path.join(REMOTION_DIR, "public"),
      onProgress: (p) => {
        if (p % 25 === 0) onProgress?.(`Bundling Remotion compositions ${p}%`);
      },
    });
    // prune older bundles
    for (const d of fs.readdirSync(root)) if (d !== hash) fs.rmSync(path.join(root, d), { recursive: true, force: true });
    return dir;
  })();
  try {
    return await bundlePromise;
  } finally {
    bundlePromise = null;
  }
}

// ---------- rendering ----------

export interface RemotionRenderInput {
  props: Omit<EditCompositionProps, "videoSrc" | "visuals"> & { visuals: Array<{ file: string; start: number; end: number; concept?: string }> };
  cleanFile: string; // absolute path of the cut + cleaned intermediate
  outPath: string;
  onProgress?: (fraction: number, message?: string) => void;
}

function linkOrCopy(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

export async function renderWithRemotion(input: RemotionRenderInput): Promise<void> {
  const cap = remotionCapability();
  if (!cap.ok) throw new Error(cap.reason || "Remotion unavailable");
  const serveUrl = await ensureBundle((m) => input.onProgress?.(0.02, m));

  // Per-render media lives inside the served bundle so the composition can use staticFile().
  const renderId = createHash("sha1").update(input.outPath).digest("hex").slice(0, 10);
  // Remotion serves the bundle's `public/` folder at /public/<path>, which is what staticFile() resolves to.
  const mediaRel = `media/${renderId}`;
  const mediaDir = path.join(serveUrl, "public", mediaRel);
  fs.rmSync(mediaDir, { recursive: true, force: true });
  linkOrCopy(input.cleanFile, path.join(mediaDir, "clean.mp4"));
  const visuals = input.props.visuals.map((v, i) => {
    const ext = path.extname(v.file) || ".jpg";
    const rel = `${mediaRel}/img-${i}${ext}`;
    linkOrCopy(v.file, path.join(serveUrl, "public", rel));
    return { src: rel, start: v.start, end: v.end, concept: v.concept };
  });
  const props: EditCompositionProps = { ...input.props, videoSrc: `${mediaRel}/clean.mp4`, visuals };

  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const videoOnly = input.outPath.replace(/\.mp4$/, ".video.mp4");
  try {
    input.onProgress?.(0.05, "Preparing composition");
    const composition = await selectComposition({
      serveUrl,
      id: "Edit",
      inputProps: props,
      browserExecutable: cap.browser!,
      chromiumOptions: { gl: "swangle" },
      logLevel: "error",
      timeoutInMilliseconds: 120000,
    });
    const concurrency = Math.max(1, Math.min(4, os.cpus().length - 1));
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: videoOnly,
      inputProps: props,
      muted: true,
      concurrency,
      browserExecutable: cap.browser!,
      chromiumOptions: { gl: "swangle" },
      imageFormat: "jpeg",
      jpegQuality: 85,
      x264Preset: "veryfast",
      crf: 20,
      logLevel: "error",
      timeoutInMilliseconds: 120000,
      onProgress: ({ progress }) => input.onProgress?.(0.05 + progress * 0.9, `Rendering with Remotion ${Math.round(progress * 100)}%`),
    });
    input.onProgress?.(0.96, "Adding audio");
    await ffmpeg(["-i", videoOnly, "-i", input.cleanFile, "-map", "0:v:0", "-map", "1:a:0?", "-c", "copy", "-shortest", "-movflags", "+faststart", input.outPath]);
  } finally {
    fs.rmSync(videoOnly, { force: true });
    fs.rmSync(mediaDir, { recursive: true, force: true });
  }
}
