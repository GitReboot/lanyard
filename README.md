# Lanyard

**Scan a conference badge and know who you're talking to — before the conversation ends.**

Point your phone at someone's badge. It extracts their details, then researches both
the person and their company against live web search, and shows you a glanceable card:
what they work on, what their company actually does, and what its engineering org is
known for. Every claim is cited. Anything it can't verify, it doesn't show.

Built for the DevFest DC 2026 Build-a-thon.

---

## Status

**Working end to end.** Not yet deployed.

| Area | State |
|---|---|
| Badge scan → structured contact | done, tested on angled/multi-company/name-only badges |
| Person research (grounded, cited) | done |
| Company research (grounded, cited, multi-company) | done |
| Perspective-corrected badge crop | done |
| Contacts: save, edit, delete, follow-up priority | done |
| Export / import between devices | done |
| Firestore security rules | done, locked down and verified |
| Cloud Run deploy | **prepared, not yet run** |

---

## How it works

Three stages, deliberately kept separate.

**1. Scan** — `app/api/scan/route.ts`
Rear camera → client-side downscale to 1280px → Gemini vision with a strict response
schema. Returns name, title, companies[], emails[], LinkedIn, raw OCR text, and the
badge's four corners.

**2. Research** — `app/api/research/route.ts`
One grounded Google Search call per subject. Person and company run as independent
requests so each resolves on its own.

**3. Structure** — `app/api/structure/route.ts`
Converts research prose into typed JSON. No tools, no thinking budget.

### Decisions that aren't obvious

**Research and structuring must be separate calls.** Asking Gemini for JSON output
*suppresses tool use entirely* — it treats the request as formatting and answers from
memory. Verified directly: the same question asked in prose returned 8 grounding chunks;
with `"return ONLY JSON"` it performed no search at all and returned empty
`groundingMetadata`.

**The company gets its own search.** A person-focused query never searches the employer —
in one test all four generated queries were about the person, and company facts arrived
only incidentally from pages that happened to rank. Fine for a household name, useless
for the unknown employer where you actually need it.

**`grounded` reflects whether search actually ran**, not whether the API call succeeded.
When it didn't, person-level claims are stripped rather than displayed.

**LinkedIn URLs are dropped unless linkedin.com was genuinely a source.** LinkedIn walls
itself off from Search grounding — across every lookup tested it never appeared among the
sources, yet the model still produced plausible profile URLs from memory. An unverified
URL doesn't 404, it lands on a real *different* person. The UI falls back to a pre-filled
LinkedIn search instead.

**Anonymous auth, no login screen.** Judges will not create an account to try a demo.
The anonymous uid is also the multi-tenancy mechanism — contacts live at
`users/{uid}/contacts`, so every device is naturally isolated.

**Company research is cached in-process.** Conferences skew to a handful of employers;
ten Capital One badges shouldn't bill ten identical searches. Measured 9.4s → 1.1s on
a repeat.

**Retries are bounded by a wall clock.** The SDK retries 5× by default with exponential
backoff; wrapping that in our own loop compounded into ~15 attempts and one bad Gemini
moment took **141 seconds** to fail. SDK retries are now off, ours are budgeted: worst
case 23s.

---

## Stack

Next.js 16 (App Router, TS, Tailwind) · Firebase Anonymous Auth + Firestore ·
Gemini `gemini-flash-latest` (vision + grounded search) · Canvas API for image
compression and perspective deskew · Cloud Run.

## Setup

Use a **personal Gmail** — university Workspace accounts often block Firebase project
creation.

1. **Gemini key** → https://aistudio.google.com/apikey. **Billing must be enabled** —
   Search grounding's free 1,500/day allowance only exists on paid tiers; on a free key
   grounded calls 429 immediately.
2. **Firebase** → console → create project → **Authentication → Anonymous → Enable** →
   **Firestore → Create database** → **Project settings → Web app** → copy config.
3. **Publish `firestore.rules`** (console → Firestore → Rules). Test mode allows
   *anyone* to read and write your entire database — verified with an unauthenticated
   curl — and test rules expire, after which the app silently breaks.
4. `cp .env.local.example .env.local`, fill in, `npm run dev`.

Verify both halves before touching the UI:

```bash
node test-assets/verify-firebase.mjs   # anonymous auth + Firestore read/write/cleanup
```

## Deploy

See **[DEPLOY.md](./DEPLOY.md)**. Cloud Run, because grounded search takes 7–36s and
Vercel/Netlify free tiers cap functions at 10s.

---

## What's left

**Before Friday**
- [ ] Run `./deploy.sh` once and confirm the URL loads **over cellular, not wifi**
- [ ] Re-scan the existing saved contact — earlier crops were rendered by a buggy
      affine transform (fixed) and are still stored garbled
- [ ] Seed 3–4 demo contacts as a fallback if Gemini 503s during judging

**On the day**
- [ ] `gcloud run services update lanyard --min-instances 1` in the morning to
      avoid a cold start mid-demo; set back to 0 afterwards
- [ ] Push the repo public
- [ ] Record the video walkthrough

**Known gaps**
- Contacts don't roam between devices by design; export/import is the transfer path
- `notes` is seeded by the model and meant to be overwritten by you
- Research takes ~10–20s; person and company sections fill in independently to mask it
