# Deploying to Cloud Run

## Why Cloud Run

Grounded Gemini search takes **7–36 seconds** (measured, avg ~15s). Vercel Hobby and
Netlify free both cap functions at **10s**, and Netlify Pro only reaches 26s — all
below the worst case. Cloud Run lets us set `--timeout 300`, which removes the
constraint entirely.

Firebase stays on the **Spark** (free) plan — Cloud Run only replaces where the
Next.js app runs. Auth and Firestore are untouched.

## One-time setup (do this before the event, not on venue wifi)

**1. Install the gcloud CLI** — https://cloud.google.com/sdk/docs/install

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

**2. Enable the APIs** (~2 min, once per project):

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

**3. Confirm billing is attached** to the project. Cloud Run scales to zero and has a
standing free tier; a demo app costs approximately nothing.

## Deploy

```bash
./deploy.sh
```

Reads everything from `.env.local`, so there's one source of truth. Prints the public
URL when it finishes. First deploy takes ~4–6 minutes (image build); later ones ~2.

Overrides:

```bash
SERVICE=lanyard REGION=us-east1 ./deploy.sh
```

## How env vars work here

Two different mechanisms, and mixing them up is the most likely deploy bug:

| Variable | Mechanism | Why |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | `--set-build-env-vars` | Inlined into the client bundle **at build time**. Setting them only at runtime silently produces a broken build. |
| `GEMINI_API_KEY` | `--set-env-vars` | Read server-side at request time. Never reaches the browser. |

## Verifying a deploy

```bash
URL=$(gcloud run services describe lanyard --region us-east1 --format='value(status.url)')
curl -s -o /dev/null -w "%{http_code}\n" "$URL"                       # expect 200
curl -s -X POST "$URL/api/research" -H 'Content-Type: application/json' \
  -d '{"kind":"company","company":"Mapbox"}' | head -c 200            # expect JSON with sources
```

Then open the URL on a phone **over cellular, not wifi** — that proves it's genuinely
public and not just reachable on the local network.

## Notes

- **Region `us-east1`** is closest to Arlington VA.
- **`--min-instances 0`** means it scales to zero and costs nothing idle, at the price of
  a cold start (~2–4s) on the first hit. If you want the demo instant, set
  `--min-instances 1` on the morning of the event and back to 0 afterwards.
- **Firestore security rules are still in test mode.** Fine for a demo, but they expire —
  check the Firebase console before the event, because expired rules deny all reads and
  writes and the app will look broken.
- `allowedDevOrigins` in `next.config.ts` only affects `next dev`. It has no effect in
  production, so the venue-wifi IP problem disappears once deployed.

## Teardown

```bash
gcloud run services delete lanyard --region us-east1
```
