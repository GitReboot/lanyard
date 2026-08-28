import { NextResponse } from "next/server";
import {
  buildCompanies,
  buildPerson,
  client,
  companyStructurePrompt,
  EMPTY_RESEARCH,
  personStructurePrompt,
  runStructure,
  type Researched,
} from "@/lib/enrich-core";

/** No search and no thinking — measured ~2s. */
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const kind: "person" | "company" = body.kind === "company" ? "company" : "person";

    if (kind === "person") {
      const research: Researched = body.research ?? EMPTY_RESEARCH;
      const parsed = await runStructure(
        client(),
        personStructurePrompt(research.text, body.company ?? "", body.title ?? ""),
      );
      if (!parsed) {
        return NextResponse.json({ error: "Could not structure the person." }, { status: 502 });
      }
      return NextResponse.json({ person: buildPerson(parsed, research) });
    }

    const names: string[] = Array.isArray(body.names) ? body.names : [];
    const research: Researched[] = Array.isArray(body.research) ? body.research : [];
    if (names.length === 0) return NextResponse.json({ companies: [] });

    const parsed = await runStructure(
      client(),
      companyStructurePrompt(names.map((n, i) => ({ name: n, notes: research[i]?.text ?? "" }))),
    );
    if (!parsed) {
      return NextResponse.json({ error: "Could not structure the companies." }, { status: 502 });
    }
    return NextResponse.json({ companies: buildCompanies(parsed, names, research) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Structuring failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
