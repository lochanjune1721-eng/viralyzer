# Viralyzer: Next.js app + FFmpeg (with libass for burned-in captions).
FROM node:22-bookworm-slim AS base
# ffmpeg + libass for the cut/clean/caption pass, python for the video-use engine,
# and the shared libraries Chrome Headless Shell needs for Remotion renders.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg fontconfig ca-certificates python3 python3-pip curl \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 \
    libx11-xcb1 libxcb1 libxext6 libglib2.0-0 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Remotion: download Chrome Headless Shell (non-fatal; the runner falls back to
# Debian's chromium) and pre-bundle the compositions so the first render is fast.
RUN npx remotion browser ensure || echo "Chrome Headless Shell download failed; will use apt chromium"
RUN REMOTION_BUNDLE_DIR=/app/remotion-bundle npx tsx scripts/remotion-bundle.ts

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATA_DIR=/data/db STORAGE_DIR=/data/storage NODE_OPTIONS=--no-warnings=ExperimentalWarning \
    REMOTION_BUNDLE_DIR=/app/remotion-bundle
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
COPY --from=build /app/vendor ./vendor
COPY --from=build /app/remotion ./remotion
COPY --from=build /app/remotion-bundle ./remotion-bundle
COPY --from=build /app/node_modules/.remotion ./node_modules/.remotion
# If the headless shell download failed at build time, install Debian's chromium instead.
RUN if [ -z "$(find node_modules/.remotion -type f -name chrome-headless-shell 2>/dev/null | head -1)" ]; then \
      apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*; fi
RUN pip3 install --no-cache-dir --break-system-packages -r vendor/video-use/requirements.txt
RUN mkdir -p /data/db /data/storage
EXPOSE 3000
CMD ["node", "server.js"]
