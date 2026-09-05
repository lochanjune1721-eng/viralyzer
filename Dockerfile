# Viralyzer: Next.js app + FFmpeg (with libass for burned-in captions).
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig ca-certificates python3 python3-pip && rm -rf /var/lib/apt/lists/*

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

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATA_DIR=/data/db STORAGE_DIR=/data/storage NODE_OPTIONS=--no-warnings=ExperimentalWarning
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
COPY --from=build /app/vendor ./vendor
RUN pip3 install --no-cache-dir --break-system-packages -r vendor/video-use/requirements.txt
RUN mkdir -p /data/db /data/storage
EXPOSE 3000
CMD ["node", "server.js"]
