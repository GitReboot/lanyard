# Friday runbook — Project A (Lanyard)

Ordered by when you need it. Everything above "On arrival" should already be done.

---

## Before you leave home

- [ ] `./deploy.sh` has been run **at least once successfully** — do not let Friday be
      the first attempt. IAM, Cloud Build and API enablement all fail on first run and
      none of them fail quickly.
- [ ] The Cloud Run URL opens on your phone **over cellular with wifi off**. That's the
      only proof it's genuinely public.
- [ ] `firestore.rules` is published. Confirm with:
      `curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://firestore.googleapis.com/v1/projects/badge-crm/databases/(default)/documents/users/X/contacts" -H 'Content-Type: application/json' -d '{"fields":{}}'`
      → must print **403**.
- [ ] 3–4 demo contacts saved in the app on the demo phone.
- [ ] Phone charged, hotspot tested, laptop charger packed.

## On arrival

- [ ] Warm the service so no judge hits a cold start:
      ```
      gcloud run services update lanyard --region us-east1 --min-instances 1
      ```
- [ ] Open the URL on the demo phone and scan one badge to confirm the whole path works
      on venue conditions.
- [ ] Check Gemini is healthy — we saw sustained 503s while building:
      ```
      curl -s -o /dev/null -w "%{http_code}\n" \
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \
        -H "x-goog-api-key: $GEMINI_API_KEY" -H 'Content-Type: application/json' \
        -d '{"contents":[{"parts":[{"text":"ok"}]}]}'
      ```
      200 = fine. 503 = Gemini is degraded; lead the demo with saved contacts.

## Demo (60 seconds)

> "I'll meet thirty people today and I'll forget every one of them by Monday."

1. Scan a **judge's own badge**. Their details appear immediately.
2. While research runs: *"it's searching the web for them and for their employer,
   separately."*
3. Person card lands — role, what they work on, notable work, previous employers.
4. Company card lands — what it does, size, **what its engineering org is known for**.
5. Point at the source chips: *"every claim is cited. If we can't verify it, we don't
   show it — including LinkedIn URLs, which the model will happily invent."*

**The strongest beat is scanning the judge's own badge.** They can check whether it's
right, and that's the whole credibility argument in five seconds.

**If they have a name-only badge** (most of last year's were), that's not a failure —
it prompts for the company, you type it, and company research still runs. Say so out loud;
it shows the design handles the common case.

## If something breaks

| Symptom | Cause | Do this |
|---|---|---|
| Research errors or hangs | Gemini 503 (upstream, seen repeatedly) | Open a pre-saved contact instead. Say the research already ran. |
| Everything denied / list empty | Firestore rules wrong or expired | Firebase console → Rules → republish `firestore.rules` |
| Blank page on phone | Only affects `next dev`, not Cloud Run | Use the Cloud Run URL, not the laptop IP |
| Slow first load | Cold start | `--min-instances 1` (see above) |
| Camera opens file picker | Desktop browser | Use a phone; `capture="environment"` is mobile-only |

## Submission checklist

- [ ] **Repo** — push public
- [ ] **Deployed URL** — the Cloud Run URL
- [ ] **Video walkthrough** — record the 60s demo above, on a phone, with a real badge
- [ ] **One-line description** —
      *Scan a conference badge and instantly know who you're talking to and what their
      company does, with every claim cited.*
- [ ] **What it solves** — you meet dozens of people at a conference, badges tell you
      almost nothing, and you can't research someone mid-handshake. This does it in the
      time it takes to shake hands.
- [ ] **For the judges** — worth mentioning: research and structuring are separate calls
      because asking Gemini for JSON silently disables its search tool; the app
      distinguishes *verified* from *unverified* and withholds rather than guesses;
      LinkedIn URLs are dropped unless a real source backs them, because a wrong profile
      is worse than none.

## Teardown (after the event)

```
gcloud run services update lanyard --region us-east1 --min-instances 0
```
