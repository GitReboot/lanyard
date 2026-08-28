# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, and they
# arrive via .env.production, which deploy.sh writes from .env.local.
#
# Do NOT declare them as ARG/ENV here. `gcloud run deploy --source` does not turn
# --set-build-env-vars into docker --build-arg, so the ARGs resolve to empty
# strings — and an empty ENV outranks .env.production, silently compiling a build
# with no Firebase config at all.
#
# GEMINI_API_KEY is absent by design: it's read server-side at runtime and must
# never enter the image or the client bundle.
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

# standalone omits public/ and .next/static by design; copy them in explicitly.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
# Cloud Run injects PORT; server.js honours it.
ENV PORT=8080 HOSTNAME=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]
