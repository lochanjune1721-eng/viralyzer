# Viralyzer

An end-to-end web app for short-form video creators: **Ideation → Scripting → Shooting → Editing → Uploading** in one place. A project moves through the five stages; the left sidebar (bottom tab bar on phones) shows where every project sits.

## What each stage does

| Stage | What happens |
| --- | --- |
| **Ideation** | Type an idea or paste a reference (link, headline, tweet). Your niche from onboarding feeds every later stage. "Script this" moves the project on. |
| **Scripting** | A short tap-to-select angle interview (take, controversial/safe, tone, audience, length, or a free-text custom angle), then DeepSeek returns **exactly three** scripts with different hooks (question / bold claim / story…). Pick one, edit inline, or ask for tweaks ("make it shorter"); every version stays in history. "Shoot this" attaches the final script. |
| **Shooting** | Browser teleprompter + camera (`getUserMedia`, front camera by default, flip button). Script scrolls near the lens; play/pause, speed, font size, mirror, restart, and optional **voice-paced scrolling** (Web Speech API). Records in-browser (`MediaRecorder`) with multiple takes, previews, delete, primary/selected flags, or upload footage shot elsewhere. Takes are normalised to H.264 mp4 server-side. |
| **Editing** | Automatic first pass: joins the selected takes, transcribes with word timestamps, detects **repeated attempts** (fuzzy match against the script and neighbouring lines, best take chosen by script similarity / fillers / hesitation / completeness), removes fillers, long pauses and dead air, then shows a timeline where any single cut can be undone. Choose a format: **split screen** (auto-sourced images per concept, replaceable), **full-frame with overlays**, **captions only**, or **motion design** (kinetic key phrases + lower third). Captions are always on, word-synced, four style presets, editable text. Export 9:16 / 1:1 / 16:9 with FFmpeg (noise reduction + loudness normalisation) and live progress. |
| **Uploading** | Connect TikTok, Instagram Reels, YouTube Shorts, X and LinkedIn via OAuth (or one Ayrshare key). LLM-drafted caption, hashtags and title; checkbox per platform; **Post everywhere**; schedule for later; per-platform success/failure with retry and stored post links. |

## Running it

Requirements: Node 22.13+ (uses the built-in `node:sqlite`), **ffmpeg with libass** on `PATH` (or `FFMPEG_PATH`).

```bash
cp .env.example .env      # fill in what you have; everything is optional for a local run
npm install
npm run dev               # http://localhost:3000
```

Phones only expose the camera on HTTPS. For testing the Shooting stage on your phone, run `npm run dev -- --experimental-https` or put the dev server behind a tunnel (ngrok, Cloudflare Tunnel) and set `PUBLIC_BASE_URL` to that URL.

### Docker

```bash
docker compose up --build   # ffmpeg + fonts included; data persists in the viralyzer-data volume
```

### Hosting

This app needs a **persistent Node server with ffmpeg**: takes are normalised, cleanup and renders run as background jobs in the server process, and media plus the SQLite database live on local disk. Any Docker host (Railway, Fly.io, Render, a VPS) works with the included `Dockerfile`.

Vercel builds and serves the UI, ideation, scripting and account connections, but serverless functions have no ffmpeg, a read-only project directory (data falls back to `/tmp`, which is ephemeral) and no long-running background work, so the Shooting uploads, Editing pipeline and renders will not run there. `output: "standalone"` is automatically disabled on Vercel because its builder is incompatible with it.

### Keys (all optional, the app degrades gracefully)

| Variable | Used for | Without it |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Scripts, refinements, captions, visual concepts, key phrases | Clearly-labelled placeholder scripts and heuristics |
| `OPENAI_API_KEY` / `GROQ_API_KEY` / `DEEPGRAM_API_KEY` | Word-level transcription (Whisper / Nova) | The script is time-aligned to the footage, so cuts for retakes cannot be detected |
| `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `GOOGLE_CSE_KEY`+`GOOGLE_CSE_CX` | Image sourcing | Keyless Wikipedia + Openverse search |
| `GOOGLE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `INSTAGRAM_APP_ID/SECRET`, `X_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET` | Native OAuth publishing | Platform shows "needs app credentials" |
| `AYRSHARE_API_KEY` | Aggregator publishing to every platform with one key | Native adapters are used |
| `PUBLIC_BASE_URL` | OAuth callbacks (`/api/connections/<platform>/callback`) and platforms that fetch the video by URL (Instagram, Ayrshare) | Only local publishing flows work |

## Architecture

```
src/app                 Next.js 16 App Router pages + route handlers (src/app/api/**)
src/components/shell    Sidebar / bottom tab bar / onboarding / stage index
src/components/<stage>  One folder per stage, each a self-contained workspace
src/lib/db              node:sqlite database + repository (projects, jobs, connections, publications)
src/lib/scripting       DeepSeek client, prompts, three-variant generation, refine, caption
src/lib/editing         transcribe.ts (OpenAI / Groq / Deepgram / mock), cleanup.ts (retake, filler, pause detection),
                        visuals.ts (concept extraction + image search), captions.ts (ASS generator), render.ts (FFmpeg graphs)
src/lib/publish         OAuth helpers, one adapter per platform, Ayrshare adapter, scheduler
src/lib/media/ffmpeg.ts ffmpeg/ffprobe runner with progress parsing
storage/, data/         Media files and the SQLite database (configurable, gitignored)
```

The `Project` object (`src/lib/types.ts`) is the contract between stages: `idea/reference` → `angle/scripts/finalScript` → `takes` → `edit` (transcript, cuts, visuals, captions, render) → `publish`. Each stage only reads and writes its own slice.

Background work (take normalisation, cleanup analysis, renders, visual sourcing) runs as jobs in the Node process and is polled through `/api/jobs/:id`. Scheduled posts are processed every 30 s in-process (`src/instrumentation.ts`) and can also be triggered with `GET /api/cron/publish`.

### Auth

v1 uses a signed cookie that maps to a local user record; onboarding collects name, handle and niche. There is no password flow yet, so deploy behind your own auth proxy if the instance is exposed.

## Scripts

```bash
npm run dev / build / start / lint
npx tsx scripts/test-cleanup.ts     # exercise the retake / filler / pause detector on a synthetic transcript
npx tsx scripts/test-render.ts      # render every format + aspect from a synthetic clip
```
