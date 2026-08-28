import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import type { ExtractedContact } from "@/lib/types";

/**
 * Gemini runs server-side with a plain API key. This keeps the key out of the
 * browser and means we don't need Firebase App Check or a Blaze upgrade.
 */
export const maxDuration = 60;

// Same chain as enrichment: the alias can 503 while concrete models are fine.
const MODEL_CHAIN = [
  process.env.GEMINI_MODEL,
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-flash-lite-latest",
].filter((m): m is string => Boolean(m));

const contactSchema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING, description: "Person's full name" },
    title: { type: Type.STRING, description: "Job title, empty string if absent" },
    company: { type: Type.STRING, description: "Primary company or organization" },
    companies: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Every distinct organisation named on the badge, one per entry. Split on /, &, |, comma, or 'and'.",
    },
    email: { type: Type.STRING, description: "Primary email address, empty string if absent" },
    emails: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Every distinct email address printed on the badge, one per entry.",
    },
    linkedin: { type: Type.STRING, description: "LinkedIn handle or URL, empty string if absent" },
    notes: {
      type: Type.STRING,
      description:
        "One short sentence on why this person is worth following up with, inferred from their role and company.",
    },
    rawText: { type: Type.STRING, description: "All text visible in the image, verbatim" },
    quad: {
      type: Type.ARRAY,
      description:
        "The badge's four corners in image order: top-left, top-right, bottom-right, bottom-left. " +
        "Each is [x, y] normalized to 0-1000. Empty array if no badge outline is discernible.",
      items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    },
  },
  required: [
    "name", "title", "company", "companies", "email", "emails", "linkedin", "notes", "rawText", "quad",
  ],
  propertyOrdering: [
    "name", "title", "company", "companies", "email", "emails", "linkedin", "notes", "rawText", "quad",
  ],
};

const PROMPT = `You are reading a photo taken at a developer conference. It may be a
conference badge, a business card, or a lanyard insert — handle all of them.

Extract the person's contact details. Rules:
- Use an empty string for anything not visible. Never invent an email or a handle.
- Ignore conference branding, sponsor logos, ticket types, and QR codes.
- Badges often name more than one organisation, e.g. "NVRSE / Arry of Stars" — an agency and a
  client, or two ventures of the same founder. Put EACH one in "companies" as its own entry, and
  set "company" to the first. If there's only one, "companies" has a single entry.
- Do not split a single company whose own name contains a separator (e.g. "Johnson & Johnson",
  "Ben & Jerry's"). Only split when the parts are plainly distinct organisations.
- List EVERY email printed on the badge in "emails", and set "email" to the first.
- "notes" should be one short, specific sentence on why they're worth following up with.
- "rawText" must contain every piece of text you can read, verbatim, even the parts you ignored.
- "quad" is the badge's own outline, not the whole photo. Trace the physical card/badge edges
  even when it is rotated or photographed at an angle. If the badge fills the frame or its edges
  can't be seen, return an empty array.`;

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server." },
      { status: 500 },
    );
  }

  let imageBase64: string;
  let mimeType: string;
  try {
    const body = await request.json();
    imageBase64 = body.imageBase64;
    mimeType = body.mimeType ?? "image/jpeg";
    if (!imageBase64) throw new Error("missing imageBase64");
  } catch {
    return NextResponse.json({ error: "Expected JSON body with imageBase64." }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Walk the chain until a model answers. Verified 27 Aug 2026: the
    // `gemini-flash-latest` alias 503'd for over an hour while the concrete
    // model behind it answered normally, so a single pinned ID is a demo-killer.
    let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
    let lastError: unknown;
    for (const model of MODEL_CHAIN) {
      try {
        response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: PROMPT }],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: contactSchema,
            // Bound the request; the SDK otherwise retries 5x with long backoff.
            httpOptions: { timeout: 45_000, retryOptions: { attempts: 2 } },
          },
        });
        break;
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : "";
        const skippable =
          msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("500") ||
          msg.includes("404") || msg.includes("NOT_FOUND") || msg.includes("429") ||
          msg.includes("504") || msg.includes("DEADLINE_EXCEEDED");
        if (!skippable) throw error;
        console.warn(`[scan] ${model} unavailable, trying next:`, msg.slice(0, 120));
      }
    }
    if (!response) throw lastError ?? new Error("No Gemini model was available.");

    const text = response.text;
    if (!text) {
      return NextResponse.json({ error: "Gemini returned an empty response." }, { status: 502 });
    }

    const parsed = JSON.parse(text) as ExtractedContact & { rawText: string };

    // Guarantee the invariant the rest of the app relies on: companies[0] === company.
    const list = Array.isArray(parsed.companies) ? parsed.companies.map((c) => c.trim()) : [];
    const companies = [...new Set([parsed.company, ...list].filter(Boolean))];
    parsed.companies = companies;
    parsed.company = companies[0] ?? parsed.company ?? "";

    // A quad is only usable if it's exactly 4 [x,y] pairs; anything else is discarded
    // so the client falls back to the uncropped photo.
    const q = (parsed as { quad?: unknown }).quad;
    const validQuad =
      Array.isArray(q) && q.length === 4 && q.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((n) => typeof n === "number"));
    (parsed as { quad?: number[][] | null }).quad = validQuad ? (q as number[][]) : null;

    const mails = Array.isArray(parsed.emails) ? parsed.emails.map((e) => e.trim()) : [];
    const emails = [...new Set([parsed.email, ...mails].filter(Boolean))];
    parsed.emails = emails;
    parsed.email = emails[0] ?? parsed.email ?? "";

    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error calling Gemini.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
