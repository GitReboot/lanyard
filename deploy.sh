#!/usr/bin/env bash
# Deploy Lanyard to Cloud Run. Reads config from .env.local.
set -euo pipefail

SERVICE="${SERVICE:-lanyard}"
REGION="${REGION:-us-east1}"          # close to Arlington VA
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"

if [ -z "${PROJECT}" ] || [ "${PROJECT}" = "(unset)" ]; then
  echo "No GCP project set. Run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

if [ ! -f .env.local ]; then
  echo "Missing .env.local — it supplies the Firebase and Gemini values." >&2
  exit 1
fi

# Pull values from .env.local so there's a single source of truth.
get() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '\r' | xargs; }

GEMINI_API_KEY="$(get GEMINI_API_KEY)"
FB_API_KEY="$(get NEXT_PUBLIC_FIREBASE_API_KEY)"
FB_AUTH_DOMAIN="$(get NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)"
FB_PROJECT_ID="$(get NEXT_PUBLIC_FIREBASE_PROJECT_ID)"
FB_BUCKET="$(get NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)"
FB_SENDER="$(get NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)"
FB_APP_ID="$(get NEXT_PUBLIC_FIREBASE_APP_ID)"

for v in GEMINI_API_KEY FB_API_KEY FB_PROJECT_ID FB_APP_ID; do
  [ -n "${!v}" ] || { echo "$v is empty in .env.local" >&2; exit 1; }
done

# `gcloud run deploy --source` with a Dockerfile does NOT turn --set-build-env-vars
# into docker --build-arg, so ARG values arrive empty and NEXT_PUBLIC_* get inlined
# as "". Next reads .env.production at build time instead, which does work.
# Only the NEXT_PUBLIC_* values go in — they ship in the client bundle anyway.
# GEMINI_API_KEY stays a runtime env var and never enters the image.
cat > .env.production <<EOF
NEXT_PUBLIC_FIREBASE_API_KEY=${FB_API_KEY}
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${FB_AUTH_DOMAIN}
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${FB_PROJECT_ID}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${FB_BUCKET}
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${FB_SENDER}
NEXT_PUBLIC_FIREBASE_APP_ID=${FB_APP_ID}
EOF
trap 'rm -f .env.production' EXIT

echo "Deploying '${SERVICE}' to ${REGION} in project ${PROJECT}…"

# --timeout 300 is the point of using Cloud Run: grounded Gemini search runs
# 7-36s, which blows past the 10s cap on Vercel/Netlify free tiers.
#
# NEXT_PUBLIC_* are build args (inlined into the client bundle); GEMINI_API_KEY
# is a runtime env var so the key never ships to the browser.
gcloud run deploy "${SERVICE}" \
  --quiet \
  --source . \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --timeout 300 \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 4 \
  --concurrency 40 \
  --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY}"

echo
echo "URL:"
gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" --format='value(status.url)'
