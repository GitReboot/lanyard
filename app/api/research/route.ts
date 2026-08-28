import { NextResponse } from "next/server";
import {
  cacheCompany,
  cachedCompany,
  client,
  companyPrompt,
  personPrompt,
  runResearch,
} from "@/lib/enrich-core";

/** One grounded search per request. Measured ~4-6s, comfortably inside Vercel's 10s Hobby cap. */
export const maxDuration = 60;

export async function POST(request: Request) {
  let kind: "person" | "company";
  let name = "";
  let company = "";
  let title = "";
  try {
    const body = await request.json();
    kind = body.kind === "company" ? "company" : "person";
    name = (body.name ?? "").trim();
    company = (body.company ?? "").trim();
    title = (body.title ?? "").trim();
    if (kind === "person" && !name) throw new Error("person research needs a name");
    if (kind === "company" && !company) throw new Error("company research needs a company");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bad request.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    if (kind === "company") {
      const hit = cachedCompany(company);
      if (hit) return NextResponse.json({ ...hit, cached: true });
      const result = await runResearch(client(), companyPrompt(company));
      if (result.searched) cacheCompany(company, result);
      return NextResponse.json({ ...result, cached: false });
    }

    const result = await runResearch(client(), personPrompt(name, company, title));
    return NextResponse.json({ ...result, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
