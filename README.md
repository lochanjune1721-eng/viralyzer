# Viralyzer

An end-to-end web app for short-form video creators: **Ideation → Scripting → Shooting → Editing → Uploading** in one place. A project moves through the five stages; the left sidebar (bottom tab bar on phones) shows where every project sits.

## What each stage does

| Stage | What happens |
| --- | --- |
| **Ideation** | Type an idea or paste a reference (link, headline, tweet). Your niche from onboarding feeds every later stage. "Script this" moves the project on. |
| **Scripting** | A short tap-to-select angle interview (take, controversial/safe, tone, audience, length, or a free-text custom angle), then DeepSeek returns **exactly three** scripts with different hooks (question / bold claim / story…). Pick one, edit inline, or ask for tweaks ("make it shorter"); every version stays in history. "Shoot this" attaches the final script. |
| **Shooting** | Browser teleprompter + camera (`getUserMedia`, front camera by default, flip button). Script scrolls near the lens; play/pause, speed, font size, mirror, restart, and optional **voice-paced scrolling** (Web Speech API). Records in-browser (`MediaRecorder`) with multiple takes, previews, delete, primary/selected flags, or upload footage shot elsewhere. Takes are normalised to H.264 mp4 server-side. |
| **Editing** | Upload a raw take (a three-minute phone video is fine) or arrive from Shooting, and answer one question: **what kind of edit do you need?** Pick a layout (split screen with you at the bottom and images of what you are saying on top, you on top, full-frame with pop-in visuals, motion graphics, captions only), aspect, caption style, what to cut (best take per line, silences, ums and uhs), punch-in zooms, lower third and a target length, then paste the script you read. One job does the rest: transcribes with word timestamps, keeps the **best take** of every repeated line, removes fillers, pauses and audio-detected silences, cleans the audio (denoise + loudness), sources images per concept, and renders the layout with **Remotion templates** (word-highlight captions, springing B-roll cards, kinetic titles, lower third, progress bar). The result shows first with Download and Publish; below it every cut can be undone on the timeline, visuals swapped, captions edited and the layout changed for a re-render. Exports 9:16 / 1:1 / 16:9. |
| **Uploading** | Connect TikTok, Instagram Reels, YouTube Shorts, X and LinkedIn via OAuth (or one Ayrshare key). LLM-drafted caption, hashtags and title; checkbox per platform; **Post everywhere**; schedule for later; per-platform success/failure with retry and stored post links. |

## Layout renders (Remotion templates)

Layouts are React compositions under `remotion/` (split screen, overlay, captions, motion) rendered server-side with `@remotion/renderer` and a headless Chrome. Remotion draws the picture only; the audio is the cleaned, loudness-normalised cut from the FFmpeg pass, muxed back in so sync stays exact. Templates get word-timed captions, the B-roll schedule, cut points (for punch-in zooms), key phrases and your handle for the lower third.

- Browser: `npx remotion browser ensure` downloads Chrome Headless Shell into `node_modules/.remotion`. The Docker image, the Codespaces devcontainer and `scripts/codespaces-start.sh` all do this for you, and any Chromium works via `REMOTION_BROWSER_EXECUTABLE`.
- Bundle: compositions are bundled once per content hash (`npm run remotion:bundle`, done at Docker build time) into `REMOTION_BUNDLE_DIR`.
- Fallback: if no browser is available, or a render fails, the same edit renders with the built-in FFmpeg engine and the result carries a warning saying so. `REMOTION_DISABLE=1` forces that engine.
- Memory: budget about 2 GB of RAM for a 1080x1920 render.
- Licence: Remotion is free for individuals and companies of up to three people; larger companies need a [company licence](https://remotion.dev/license).

## Edit by conversation (video-use engine)

The Editing stage embeds the open-source [browser-use/video-use](https://github.com/browser-use/video-use) engine (vendored under `vendor/video-use`, MIT). After the automatic cleanup pass you can talk to the editor: "cut it down to 45 seconds", "keep only the hook and the payoff", "warm cinematic grade", "drop the part about pricing". It reads the word-timed transcript, proposes a plan and an EDL, you confirm, and it renders through `render.py`: per-segment extraction with colour grade and 30 ms audio fades, lossless concat, 2-word uppercase subtitles burned last, and social loudness normalisation. Every cut boundary can be inspected with the filmstrip-plus-waveform timeline view.

Requirements: Python 3.10+ with `pip install -r vendor/video-use/requirements.txt` (the Docker image does this). `ELEVENLABS_API_KEY` enables Scribe transcription, the engine's native word-level layer; `DEEPSEEK_API_KEY` enables the real conversation (without it only direct instructions are understood).

## Every stage works on its own

The five stages connect, but none of them requires the others:

- **Scripting** starts from any idea typed on its page.
- **Shooting** is a full teleprompter studio at `/shooting`: paste any script, choose how the text comes in (scroll up, ticker left or right, word by word), set the speed, size, colour, backdrop and countdown, drag the prompter anywhere on the frame, mirror or flip it for teleprompter glass, use voice pacing, turn the camera off for prompter-only use, go fullscreen, and drive it from the keyboard (space, arrows, R, M, F). Recordings can be downloaded or saved into a project for editing.
- **Editing** accepts any raw video at `/editing` (a three-minute take from your phone is fine) plus the script you read. It asks what kind of edit you need, then transcribes, keeps the best take of every line, flags off-script asides, removes fillers, pauses, dead air and detected silences, and renders the layout you picked.
- **Uploading** accepts a finished video at `/uploading` and goes straight to captions, hashtags and one-click posting.

## Running it

Requirements: Node 22.13+ (uses the built-in `node:sqlite`), **ffmpeg with libass** on `PATH` (or `FFMPEG_PATH`).

```bash
cp .env.example .env      # fill in what you have; everything is optional for a local run
npm install
npm run dev               # http://localhost:3000
```

Phones only expose the camera on HTTPS. For testing the Shooting stage on your phone, run `npm run dev -- --experimental-https` or put the dev server behind a tunnel (ngrok, Cloudflare Tunnel) and set `PUBLIC_BASE_URL` to that URL.

### Zero install: GitHub Codespaces (free, runs in your browser)

1. Open the repo on GitHub, click the green **Code** button, then the **Codespaces** tab, then **Create codespace on claude/creator-content-platform-my570i**.
2. Wait for the editor to open and for the terminal to say "Viralyzer is starting on port 3000" (the first start builds the app, about two minutes).
3. The terminal prints a public `https://….trycloudflare.com` address inside a box. Open it on any device, phone included. No port settings needed; the app uses that address for OAuth callbacks automatically.
4. Add your keys to `.env` in the editor (the file is created for you), then run `bash scripts/codespaces-start.sh` in the terminal to restart. The address changes on each restart.

Free accounts get 60 hours a month on a 2-core machine, and your projects stay in the codespace between sessions. The codespace pauses after 30 minutes idle; reopening it from the same Codespaces tab resumes with everything intact.

### Run it for $0

**Option A: your own computer + a free tunnel (best free option, full power, 10 minutes).**

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (free), or Node 22 + ffmpeg + Python 3.
2. `cp .env.example .env`, add your keys.
3. Start it: `docker compose up --build` (or `npm install && npm run dev`).
4. In a second terminal: `npm run tunnel`. It prints a public `https://…trycloudflare.com` URL. No account needed.
5. Put that URL in `.env` as `PUBLIC_BASE_URL` and restart. Open it on your phone: camera, recording, editing and publishing all work, rendering runs on your machine.

The quick-tunnel URL changes each time you start it. For a stable URL (needed for OAuth app settings), create a free Cloudflare account and a named tunnel, or use ngrok's free static domain.

**Option B: a free 24/7 server.** Oracle Cloud's Always Free tier gives an ARM VM with 4 cores and 24 GB RAM at no cost. Install Docker on it, clone the repo, `docker compose up -d`, and point a tunnel or a free Cloudflare domain at port 3000. About 30 minutes of setup, then it runs forever.

**Option C: free tiers of PaaS hosts (demo only).** Render and Koyeb have free Docker instances, but they give 512 MB RAM (too little for reliable 1080p renders), sleep after idle, and offer no persistent disk on the free plan, so projects are lost on every restart. Fine for a look, not for real use.

### One-click hosts that work (ffmpeg included)

- **Render**: connect the repo, choose "Blueprint", `render.yaml` provisions the Docker service and a persistent disk.
- **Railway**: "Deploy from GitHub", `railway.json` selects the Dockerfile; add a volume mounted at `/data`.
- **Fly.io**: `fly launch --copy-config`, then `fly volumes create viralyzer_data --size 20` and `fly deploy`.

Set `PUBLIC_BASE_URL` to the host's URL afterwards.

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
| `ELEVENLABS_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `DEEPGRAM_API_KEY` | Word-level transcription (Scribe / Whisper / Nova) | The script is time-aligned to the speech found by silence detection, so retakes cannot be told apart |
| `REMOTION_BROWSER_EXECUTABLE` | A Chromium binary for Remotion renders (auto-detected from `node_modules/.remotion`, Playwright caches and `/usr/bin/chromium`) | Layouts render with the FFmpeg engine |
| `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`, `GOOGLE_CSE_KEY`+`GOOGLE_CSE_CX` | Image sourcing | Keyless Wikipedia + Openverse search |
| `GOOGLE_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `INSTAGRAM_APP_ID/SECRET`, `X_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET` | Native OAuth publishing | Platform shows "needs app credentials" |
| `AYRSHARE_API_KEY` | Aggregator publishing to every platform with one key | Native adapters are used |
| `PUBLIC_BASE_URL` | OAuth callbacks (`/api/connections/<platform>/callback`) and platforms that fetch the video by URL (Instagram, Ayrshare) | Only local publishing flows work |

## Architecture

```
src/app                 Next.js 16 App Router pages + route handlers (src/app/api/**)
remotion                Remotion compositions: split / overlay / captions / motion templates
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
npm run remotion:browser            # download Chrome Headless Shell for Remotion renders
npm run remotion:bundle             # pre-bundle the Remotion compositions (REMOTION_BUNDLE_DIR)
```
