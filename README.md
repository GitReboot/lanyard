# Lanyard

**Know who you're talking to, before the conversation ends.**

You meet thirty people at a conference and lose all of them by Monday — and badges
tell you almost nothing. Lanyard turns a phone camera on a badge, extracts the
contact, then researches both the person and their employer against live Google
Search and shows a two-section card: what they work on, what their company
actually does, and what its engineering org is known for. Every claim carries a
citation, and anything search can't verify is withheld rather than guessed.

**Live:** https://lanyard-887362198556.us-east1.run.app

## Team

**Waveparticle**
- Suchir Vangaveeti — vangaveeti.v@northeastern.edu
- Uryaswi Bhowmick — uryaswibhowmick@gmail.com
- Yue Li — liyue0021@gmail.com

## Run it

```bash
cp .env.local.example .env.local   # fill in the 7 values below
npm install
npm run dev                        # http://localhost:3000
```

You need two free accounts, both about five minutes:

1. **Gemini API key** — https://aistudio.google.com/apikey. Billing must be enabled:
   Search grounding's free 1,500/day allowance only exists on paid tiers, and on a
   free key grounded calls 429 immediately.
2. **Firebase** — create a project, enable **Anonymous** sign-in and **Firestore**,
   then copy the web config. Publish `firestore.rules` before going public; test
   mode lets anyone read and write your whole database.

Verify both halves before touching the UI:

```bash
node test-assets/verify-firebase.mjs   # anonymous auth + Firestore read/write
```

Deploy to Cloud Run:

```bash
./deploy.sh                        # prints the public URL
```

## What it does

- Scan a badge or business card → name, title, **multiple companies**, **multiple
  emails**, LinkedIn, raw OCR
- **Grounded person research** — role, day-to-day work, notable projects, previous
  employers, all cited
- **Grounded company research** — what it does, size and stage, engineering angle;
  one search per company, cached per employer
- **Perspective-corrected badge crop** — Gemini returns the badge's four corners and
  a canvas triangle mesh deskews it
- Contacts: save, edit, delete, Hot/Warm/Cold follow-up, search
- Export / import JSON between devices, images included

## What we cut, and why

- **No LinkedIn scraping.** Public profiles sit behind an auth wall for logged-out
  requests and the scraping account gets banned — a demo that breaks on stage is
  worse than no feature. Search grounding returns the same public information
  legitimately.
- **Direct LinkedIn links are dropped unless a search result backs them.** The model
  will produce a plausible URL from memory; a wrong one lands you on a real
  *different* person, which is worse than no link. We fall back to a pre-filled search.
- **No account system.** Anonymous auth only — judges will not sign up to try a demo.

## Known limitations

- Most conference attendees aren't findable online. The person section will often be
  empty; the company section is the reliable half and is designed to carry the card.
- Contacts are tied to one device by design. Export/import is the transfer path.
- Minimum viable research takes 10–20s because grounded search is genuinely slow.

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
