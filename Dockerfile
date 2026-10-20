# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
ARG CACHEBUST=bfe550c-login-header
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
# Contrôle qualité intégré des prises (src/server/quality) : ffmpeg pour décoder l'audio.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY package-lock.json* ./
# onnxruntime-node : on ne garde que le binaire CPU de l'architecture courante (~45 Mo au lieu de ~550 Mo).
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force \
  && ORT=node_modules/onnxruntime-node/bin \
  && ARCH=$(node -p "process.arch") \
  && rm -rf $ORT/napi-v*/win32 $ORT/napi-v*/darwin \
  && for a in x64 arm64; do [ "$a" = "$ARCH" ] || rm -rf $ORT/napi-v*/linux/$a; done \
  && rm -f $ORT/napi-v*/linux/*/libonnxruntime_providers_cuda.so $ORT/napi-v*/linux/*/libonnxruntime_providers_tensorrt.so \
  && du -sh node_modules/onnxruntime-node
# Modèle public UVR MDX-Net « Kim_Vocal_2 » (séparation de la voix, 64 Mo), vérifié par SHA-256.
RUN mkdir -p /app/models && node -e "\
const u='https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx';\
const want='ce74ef3b6a6024ce44211a07be9cf8bc6d87728cc852a68ab34eb8e58cde9c8b';\
fetch(u).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer()}).then(b=>{\
const buf=Buffer.from(b);const h=require('crypto').createHash('sha256').update(buf).digest('hex');\
if(h!==want)throw new Error('sha256 '+h);require('fs').writeFileSync('/app/models/Kim_Vocal_2.onnx',buf);console.log('model ok',buf.length)})\
.catch(e=>{console.error(e);process.exit(1)})" \
  && node -e "require('onnxruntime-node').InferenceSession.create('/app/models/Kim_Vocal_2.onnx').then(s=>console.log('ort ok',s.inputNames))" \
  && ffmpeg -version | head -n 1
ENV SONOZZ_VOCAL_MODEL=/app/models/Kim_Vocal_2.onnx
COPY --from=build /app/dist ./dist
# Prove runtime image carries the new marker (fails build if missing)
RUN test -f dist/client/play-rev.txt \
  && grep -R "sonozz-play-rev" dist/server \
  && ls -la dist/client/assets/PlayerPage*.js
EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
