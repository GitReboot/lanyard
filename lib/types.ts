import type { Timestamp } from "firebase/firestore";

/** Fields Gemini extracts from a badge or business card photo. Only what's physically printed. */
export interface ExtractedContact {
  name: string;
  title: string;
  /** Primary employer — the first of `companies`, kept for search and display. */
  company: string;
  /** Badges often list two orgs ("NVRSE / Arry of Stars"): agency + client, or two ventures. */
  companies: string[];
  /** Primary email — the first of `emails`. */
  email: string;
  /** Badges can carry a work and a personal address, or one per venture. */
  emails: string[];
  linkedin: string;
  notes: string;
}

export interface Source {
  title: string;
  uri: string;
}

/** Researched facts about the individual. Empty when they aren't findable, which is the common case. */
export interface PersonInfo {
  headline: string;
  whatTheyDo: string;
  seniority: string;
  notable: string[];
  /** Prior employers — only ever populated from grounded sources, never inferred. */
  pastCompanies: string[];
  /** Only set when linkedin.com was genuinely among the grounding sources. */
  linkedin: string;
  /** True when search actually found this individual, as opposed to only their employer. */
  found: boolean;
  sources: Source[];
}

/** Researched facts about the employer. The reliable half — this almost always resolves. */
export interface CompanyInfo {
  name: string;
  whatItDoes: string;
  /** e.g. "Fortune 100 · ~50,000 employees" — calibrates how you talk to them. */
  sizeStage: string;
  /** Recent work and technical angle merged: launches, open source, migrations, talks. */
  engineering: string;
  sources: Source[];
}

export interface Profile {
  person: PersonInfo;
  /** One entry per organisation on the badge, each researched independently. */
  companies: CompanyInfo[];
  /** False when Search grounding was unavailable and claims fall back to model knowledge. */
  grounded: boolean;
}

/** Follow-up priority. `null`/absent means not flagged. */
export type Priority = "hot" | "warm" | "cold";

export const PRIORITIES: { value: Priority; label: string; dot: string; chip: string }[] = [
  { value: "hot", label: "Hot", dot: "bg-red-500", chip: "border-red-500 text-red-600" },
  { value: "warm", label: "Warm", dot: "bg-amber-500", chip: "border-amber-500 text-amber-600" },
  { value: "cold", label: "Cold", dot: "bg-sky-500", chip: "border-sky-500 text-sky-600" },
];

/** A stored contact: badge extraction + researched profile + our own metadata. */
export interface Contact extends ExtractedContact {
  id: string;
  priority?: Priority | null;
  /** Raw OCR text, kept as the fallback when structured extraction comes back thin. */
  rawText: string;
  profile: Profile | null;
  imageUrl: string | null;
  metAt: string;
  createdAt: Timestamp | null;
}

/** Placeholder while the person pipeline is still resolving. */
export const EMPTY_PERSON: PersonInfo = {
  headline: "",
  whatTheyDo: "",
  seniority: "Unknown",
  notable: [],
  pastCompanies: [],
  linkedin: "",
  found: false,
  sources: [],
};

export const EMPTY_EXTRACTION: ExtractedContact = {
  name: "",
  title: "",
  company: "",
  companies: [],
  email: "",
  emails: [],
  linkedin: "",
  notes: "",
};

/** The pre-sections profile shape, still present on contacts saved before the redesign. */
interface LegacyProfile {
  headline?: string;
  whatTheyDo?: string;
  seniority?: string;
  companyOneLiner?: string;
  companyContext?: string;
  notable?: string[];
  linkedin?: string;
  confidence?: string;
  sources?: Source[];
  grounded?: boolean;
}

/**
 * Contacts saved before the person/company split would otherwise render blank.
 * Upgrade them on read rather than forcing a re-scan.
 */
export function normalizeProfile(raw: unknown, companyName = ""): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Profile> & LegacyProfile;

  // Current shape.
  if (p.person && Array.isArray((p as Profile).companies)) return p as Profile;

  // Interim shape: person/company split, but a single company object.
  const single = (p as unknown as { person?: PersonInfo; company?: CompanyInfo }).company;
  if (p.person && single) {
    return { person: p.person as PersonInfo, companies: [single], grounded: p.grounded ?? false };
  }

  return {
    person: {
      headline: p.headline ?? "",
      whatTheyDo: p.whatTheyDo ?? "",
      seniority: p.seniority ?? "Unknown",
      notable: p.notable ?? [],
      pastCompanies: [],
      linkedin: p.linkedin ?? "",
      found: p.confidence === "person",
      sources: p.sources ?? [],
    },
    companies: [
      {
        name: companyName,
        whatItDoes: p.companyOneLiner ?? "",
        sizeStage: "",
        engineering: p.companyContext ?? "",
        sources: [],
      },
    ],
    grounded: p.grounded ?? false,
  };
}
