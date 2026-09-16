# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
ARG CACHEBUST=e118b71-nocache3
RUN echo "cachebust=$CACHEBUST"
COPY . .
RUN ls -la src/components/PlayerPage.jsx src/pages/play.astro \
  && (grep -n "Mode voiture" src/components/PlayerPage.jsx && exit 1 || echo "ok: no Mode voiture") \
  && grep -n "sonozz-play-rev" src/pages/play.astro \
  && grep -n "Écouter" src/components/PlayerPage.jsx
RUN npm run build \
  && test -f dist/client/play-rev.txt \
  && grep -R "sonozz-play-rev" dist/server \
  && (grep -R "Mode voiture" dist/client/assets/PlayerPage*.js && exit 1 || echo "ok: built assets without Mode voiture") \
  && ls -la dist/client/assets/PlayerPage*.js

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
# Prove runtime image carries the new marker (fails build if missing)
RUN test -f dist/client/play-rev.txt \
  && grep -R "sonozz-play-rev" dist/server \
  && ls -la dist/client/assets/PlayerPage*.js
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
