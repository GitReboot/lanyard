import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { CompanyInfo, PersonInfo, Source } from "./types";

/**
 * Model fallback chain.
 *
 * Observed 27 Aug 2026: the `gemini-flash-latest` ALIAS 503'd for over an hour
 * while `gemini-3.5-flash` — the concrete model it resolves to — answered fine.
 * The outage was in alias routing, not the model, so anything pinned to the
 * alias was simply dead. Retired IDs (gemini-2.5-*) now 404, which is why
 * pinning a version is its own trap; hence a chain rather than a single ID.
 */
export const MODEL_CHAIN = [
  process.env.GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-flash-lite-latest",
].filter((m): m is string => Boolean(m));

export const MODEL = MODEL_CHAIN[0];

/**
 * Remember which model last answered, and try it first next time.
 *
 * Model health is not static: on 27-28 Aug 2026 the `gemini-flash-latest` alias
 * returned 503 for over a day while the concrete model behind it was fine.
 * Without this, every request pays the dead model's timeout before failing over
 * — measured at 4.3s per attempt, on every single call.
 *
 * Resets when the instance recycles, so a recovered model is picked up again
 * rather than being blacklisted for good.
 */
let lastGood: string | null = null;

export function orderedModels(): string[] {
  if (!lastGood) return MODEL_CHAIN;
  return [lastGood, ...MODEL_CHAIN.filter((m) => m !== lastGood)];
}

export function noteWorkingModel(model: string) {
  lastGood = model;
}


/**
 * Research and structuring are separate HTTP endpoints, not one call, for two reasons:
 *
 * 1. Vercel's Hobby tier kills functions at 10s and `maxDuration` can't raise it.
 *    The combined pipeline took 9-13s, so it would have 504'd intermittently.
 * 2. Splitting lets the person and company sections resolve independently, so the
 *    UI fills in progressively instead of sitting behind one long spinner.
 *
 * Asking Gemini for JSON also suppresses tool use entirely — verified: the same
 * question in prose returned 8 grounding chunks, with "return ONLY JSON" it did no
 * search at all. So research must be prose and structuring must be a separate,
 * tool-free call regardless of hosting.
 */

export interface Researched {
  text: string;
  sources: Source[];
  chunks: { title: string; uri: string }[];
  queries: string[];
  searched: boolean;
}

export const EMPTY_RESEARCH: Researched = {
  text: "",
  sources: [],
  chunks: [],
  queries: [],
  searched: false,
};

export function personPrompt(name: string, company: string, title: string) {
  return `Search the web for this person, met at a developer conference.

Name: ${name || "(unknown)"}
Employer: ${company || "(unknown)"}
Badge job title: ${title || "(unknown)"}

In prose, tell me:
- Who they are and what they work on day to day
- Their seniority level
- Up to three specific, verifiable things about them: talks, projects, publications, roles
- Any PREVIOUS employers you find stated in a source
- Their LinkedIn URL if a source shows one

If you cannot find this specific individual, reply with exactly "PERSON NOT FOUND" and nothing else.
Never guess. Only report things a search result actually stated.`;
}

export function companyPrompt(company: string) {
  return `Search the web for the company "${company}".

In prose, tell me:
- What the company does, in one plain sentence a stranger would understand
- Its size and stage: headcount, public or private, industry
- What its ENGINEERING organisation is known for or working on lately: launches,
  open-source projects, infrastructure migrations, conference talks, notable tech choices

Focus on technical and engineering substance. Skip stock prices, earnings, and legal news —
this is read at a developer conference. Only report what a search result actually stated.`;
}

export function personStructurePrompt(notes: string, company: string, title: string) {
  return `Convert these research notes into JSON. Return ONLY the JSON object, no markdown fence.

=== NOTES ===
${notes || "(no research available)"}

Shape:
{
  "headline": "one sentence, max 15 words, who this person is",
  "whatTheyDo": "what they work on day to day, 1-2 sentences",
  "seniority": "one of: Junior, Mid, Senior, Staff/Principal, Manager, Director, VP, C-level, Founder, Unknown",
  "notable": ["up to 3 short specific facts about THIS PERSON from the notes"],
  "pastCompanies": ["previous employers explicitly named in the notes"],
  "linkedin": "LinkedIn URL if the notes contain one, else empty string",
  "found": true or false
}

Rules:
- Use ONLY facts present in the notes. Never add anything from your own knowledge.
- If the notes say "PERSON NOT FOUND": set found false, headline to "${title || "Unknown role"} at ${company}",
  notable to [], pastCompanies to [].
- pastCompanies must be explicitly stated in the notes, else [].
- Keep it terse. This is read at a glance during a live conversation.`;
}

export function companyStructurePrompt(blocks: { name: string; notes: string }[]) {
  const sections = blocks
    .map((b) => `=== ${b.name} ===\n${b.notes || "(no research available)"}`)
    .join("\n\n");

  return `Convert these company research notes into JSON. Return ONLY the JSON object, no fence.

${sections}

Shape:
{
  "companies": [
    {
      "name": "exact company name from its heading",
      "whatItDoes": "one plain sentence a stranger would understand",
      "sizeStage": "short marker like 'Fortune 100 · ~50,000 employees' or 'Series B · ~80 people', else empty string",
      "engineering": "what their engineering org is known for or working on lately, 1-2 sentences"
    }
  ]
}

Rules:
- ONE entry per notes block above, in the same order.
- Use ONLY facts present in the notes. Never add anything from your own knowledge.
- If a block has no research, still return its entry with empty strings.`;
}

/** A 429 means either "out of money" (permanent) or "too fast" (transient). Very different. */
export function isOutOfCredit(msg: string) {
  return /depleted|billing|check your plan/i.test(msg);
}

export function isRateLimited(msg: string) {
  return (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && !isOutOfCredit(msg);
}

/**
 * The SDK retries 5 times by default with exponential backoff up to 60s. Wrapping
 * that in our own retry loop multiplied into ~15 attempts, and one bad Gemini
 * moment took 141 seconds to fail. So: SDK retries are disabled (attempts: 1, see
 * HTTP_OPTS) and retrying happens only here, under a hard wall-clock budget.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, budgetMs = 60_000 }: { attempts?: number; budgetMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : "";
      const transient =
        msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("500") ||
        msg.includes("504") || msg.includes("DEADLINE_EXCEEDED") || isRateLimited(msg);
      if (!transient) throw error;

      const backoff = (isRateLimited(msg) ? 1200 : 500) * 2 ** i;
      // Don't start an attempt we haven't time to finish.
      if (i === attempts - 1 || Date.now() + backoff > deadline) break;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastError;
}

/**
 * Per-request ceiling. Grounded search legitimately runs 7-36s, so the timeout has
 * to be generous — but unbounded is how you get a 141s request.
 */
const HTTP_OPTS = { timeout: 45_000, retryOptions: { attempts: 1 } };

/** Grounded text embeds citation markers like "[1.1.1]" that look like a bug on screen. */
export function clean(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(/\s*\[[\d.,\s]+\]/g, "").replace(/\s{2,}/g, " ").trim();
}

export function cleanList(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, max) : [];
}

export function parseLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?/gm, "").replace(/```$/gm, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Company research is cached per server instance. Conferences skew heavily to a
 * handful of employers — scanning ten Capital One badges should not bill ten
 * identical grounded searches. Person research is never cached.
 */
const companyCache = new Map<string, { at: number; value: Researched }>();
const COMPANY_TTL_MS = 60 * 60 * 1000;

export function cachedCompany(company: string): Researched | null {
  const hit = companyCache.get(company.toLowerCase().trim());
  if (!hit || Date.now() - hit.at > COMPANY_TTL_MS) return null;
  return hit.value;
}

export function cacheCompany(company: string, value: Researched) {
  companyCache.set(company.toLowerCase().trim(), { at: Date.now(), value });
}

export function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");
  return new GoogleGenAI({ apiKey });
}

/**
 * Walks the model chain until one answers. A 400 gets one retry with
 * thinkingConfig stripped first — gemini-flash-lite-latest rejects
 * `thinkingBudget: 0` outright while accepting the same request without it.
 */
async function generateWithFallback(
  ai: GoogleGenAI,
  params: { contents: unknown; config?: Record<string, unknown> },
) {
  let lastError: unknown;
  for (const model of orderedModels()) {
    for (const dropThinking of [false, true]) {
      const config: Record<string, unknown> = { ...(params.config ?? {}) };
      if (dropThinking) {
        if (!("thinkingConfig" in config)) break;
        delete config.thinkingConfig;
      }
      try {
        const res = await ai.models.generateContent({
          model,
          contents: params.contents as never,
          config: config as never,
        });
        noteWorkingModel(model);
        return res;
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("400") && !dropThinking && "thinkingConfig" in config) continue;
        const skippable =
          msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("500") ||
          msg.includes("404") || msg.includes("NOT_FOUND") || msg.includes("504") ||
          msg.includes("DEADLINE_EXCEEDED") || isRateLimited(msg);
        if (!skippable) throw error;
        console.warn(`[gemini] ${model} unavailable, trying next:`, msg.slice(0, 120));
        break;
      }
    }
  }
  throw lastError;
}

export async function runResearch(ai: GoogleGenAI, prompt: string): Promise<Researched> {
  try {
    const res = await withRetry(() =>
      generateWithFallback(ai, {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { tools: [{ googleSearch: {} }], httpOptions: HTTP_OPTS },
      }),
      { attempts: 2, budgetMs: 95_000 },
    );
    const gm = res.candidates?.[0]?.groundingMetadata;
    const chunks = (gm?.groundingChunks ?? []).map((c) => ({
      title: c.web?.title ?? "",
      uri: c.web?.uri ?? "",
    }));
    return {
      text: res.text ?? "",
      chunks,
      queries: gm?.webSearchQueries ?? [],
      // Truthful: did search ACTUALLY run, not merely "did the call succeed".
      searched: Boolean(gm?.webSearchQueries?.length || gm?.groundingChunks?.length),
      sources: chunks.filter((c) => c.uri).slice(0, 4),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (!isOutOfCredit(msg) && !isRateLimited(msg)) throw error;
    console.warn("[research] grounded search unavailable:", msg.slice(0, 160));
    return EMPTY_RESEARCH;
  }
}

/** Structuring needs no reasoning; thinking here was measured at 646 tokens for 150 of output. */
export async function runStructure(ai: GoogleGenAI, prompt: string) {
  const res = await withRetry(() =>
    generateWithFallback(ai, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } },
      },
    }),
    { attempts: 2, budgetMs: 55_000 },
  );
  return parseLoose(res.text ?? "");
}

export function buildPerson(parsed: Record<string, unknown>, research: Researched): PersonInfo {
  const person: PersonInfo = {
    headline: clean(parsed.headline),
    whatTheyDo: clean(parsed.whatTheyDo),
    seniority: clean(parsed.seniority) || "Unknown",
    notable: cleanList(parsed.notable, 3),
    pastCompanies: cleanList(parsed.pastCompanies, 4),
    linkedin: clean(parsed.linkedin),
    found: parsed.found === true && research.searched,
    sources: research.sources,
  };

  // No real search means no basis for person-specific claims.
  if (!person.found) {
    person.notable = [];
    person.pastCompanies = [];
    person.linkedin = "";
  }

  /**
   * LinkedIn walls itself off from Search grounding — across every lookup tested,
   * linkedin.com never appeared among the sources, yet the model still produced
   * profile URLs from memory. An unverified URL doesn't 404, it lands on a real
   * *different* person, which is worse than no link.
   */
  if (!research.chunks.some((c) => /linkedin\.com/i.test(`${c.title} ${c.uri}`))) {
    person.linkedin = "";
  }

  return person;
}

export function buildCompanies(
  parsed: Record<string, unknown>,
  requested: string[],
  research: Researched[],
): CompanyInfo[] {
  const raw = Array.isArray(parsed.companies) ? (parsed.companies as Record<string, unknown>[]) : [];
  // Pair each entry with the sources from the search that produced it, so one
  // company can never cite another's pages.
  return requested.map((name, i) => {
    const c = raw[i] ?? {};
    return {
      name: clean(c.name) || name,
      whatItDoes: clean(c.whatItDoes),
      sizeStage: clean(c.sizeStage),
      engineering: clean(c.engineering),
      sources: research[i]?.sources ?? [],
    };
  });
}
