# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
# Bust stale layer cache when git SHA advances but Docker still reuses old COPY/build
ARG SONOZZ_GIT_SHA=unknown
ARG CACHEBUST=1
RUN echo "sonozz-build=$SONOZZ_GIT_SHA bust=$CACHEBUST"
COPY . .
# Prove build context contains rewritten /play (no "Mode voiture")
RUN ls -la src/components/PlayerPage.jsx \
  && wc -c src/components/PlayerPage.jsx \
  && (grep -n "Mode voiture" src/components/PlayerPage.jsx && exit 1 || echo "ok: no Mode voiture") \
  && grep -n "Écouter" src/components/PlayerPage.jsx
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
