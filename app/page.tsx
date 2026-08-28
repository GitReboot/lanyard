"use client";

import { useMemo, useRef, useState } from "react";
import { compressImage } from "@/lib/image";
import { cropBadge } from "@/lib/crop";
import { deleteContact, saveContact, setPriority, useContacts } from "@/lib/contacts";
import {
  EMPTY_EXTRACTION,
  EMPTY_PERSON,
  normalizeProfile,
  PRIORITIES,
  type ExtractedContact,
  type Priority,
  type CompanyInfo,
  type PersonInfo,
  type Profile,
} from "@/lib/types";
import { ProfileCard } from "@/components/ProfileCard";
import { LinkedInButton } from "@/components/LinkedInButton";
import { DevicePanel } from "@/components/DevicePanel";
import { ContactDetails } from "@/components/ContactDetails";

type Status = "idle" | "scanning" | "review" | "error";

export default function Home() {
  const { uid, contacts, loading, error: listError } = useContacts();
  const fileInput = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [draft, setDraft] = useState<ExtractedContact & { rawText: string }>({
    ...EMPTY_EXTRACTION,
    rawText: "",
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  // Person and company research resolve independently so each section can fill in
  // as soon as it's ready, rather than waiting on the slower of the two.
  const [enrichingPerson, setEnrichingPerson] = useState(false);
  const [enrichingCompanies, setEnrichingCompanies] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /** Deskewed badge crop, stored with the contact. Null until the crop resolves. */
  const [badgeImage, setBadgeImage] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Two-step delete rather than window.confirm, which is jarring on mobile.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [filter, setFilter] = useState<Priority | "all" | "flagged">("all");

  const filtered = useMemo(() => {
    const byPriority = contacts.filter((c) => {
      if (filter === "all") return true;
      if (filter === "flagged") return Boolean(c.priority);
      return c.priority === filter;
    });
    const q = search.trim().toLowerCase();
    if (!q) return byPriority;
    return byPriority.filter((c) =>
      [
        c.name,
        c.title,
        c.company,
        c.profile?.person?.headline,
        ...(c.profile?.companies ?? []).map((x) => x.name),
        ...(c.profile?.person?.notable ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [contacts, search, filter]);

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed.");
    return data as T;
  }

  /**
   * Two independent pipelines, each research -> structure. Split across separate
   * requests so no single call approaches the host's function timeout, and so the
   * person card can appear while company research is still running.
   */
  async function runEnrichment(c: ExtractedContact) {
    const names = (c.companies?.length ? c.companies : [c.company]).filter(Boolean).slice(0, 3);
    if (!c.name && names.length === 0) return;

    setEnrichError(null);
    setProfile(null);

    const merge = (patch: Partial<Profile>) =>
      setProfile((prev) => ({
        person: patch.person ?? prev?.person ?? EMPTY_PERSON,
        companies: patch.companies ?? prev?.companies ?? [],
        grounded: patch.grounded || prev?.grounded || false,
      }));

    const personRun = (async () => {
      if (!c.name) return;
      setEnrichingPerson(true);
      try {
        const research = await postJson<{ searched: boolean }>("/api/research", {
          kind: "person",
          name: c.name,
          company: c.company,
          title: c.title,
        });
        const { person } = await postJson<{ person: PersonInfo }>("/api/structure", {
          kind: "person",
          research,
          company: c.company,
          title: c.title,
        });
        merge({ person, grounded: research.searched });
      } finally {
        setEnrichingPerson(false);
      }
    })();

    const companyRun = (async () => {
      if (names.length === 0) return;
      setEnrichingCompanies(true);
      try {
        const research = await Promise.all(
          names.map((n) => postJson<{ searched: boolean }>("/api/research", { kind: "company", company: n })),
        );
        const { companies } = await postJson<{ companies: CompanyInfo[] }>("/api/structure", {
          kind: "company",
          names,
          research,
        });
        merge({ companies, grounded: research.some((r) => r.searched) });
      } finally {
        setEnrichingCompanies(false);
      }
    })();

    // Surface a failure only if BOTH halves fail; one working section is still useful.
    const results = await Promise.allSettled([personRun, companyRun]);
    if (results.every((r) => r.status === "rejected")) {
      const first = results[0];
      setEnrichError(first.status === "rejected" ? String(first.reason?.message ?? first.reason) : "Research failed.");
    }
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus("scanning");
    setScanError(null);
    setProfile(null);
    setEnrichError(null);
    setBadgeImage(null);
    setPreview(URL.createObjectURL(file));

    try {
      const { base64, mimeType } = await compressImage(file);
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed.");

      setDraft(data);
      setStatus("review");
      // Neither of these should block the fields already on screen.
      void runEnrichment(data);
      void cropBadge(file, data.quad ?? null)
        .then((cropped) => {
          if (cropped) setBadgeImage(cropped);
        })
        .catch(() => {
          /* Crop is a nicety; the uncropped preview stays if it fails. */
        });
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleSave() {
    if (!uid) return;
    await saveContact(uid, draft, profile, badgeImage);
    reset();
  }

  function reset() {
    setStatus("idle");
    setDraft({ ...EMPTY_EXTRACTION, rawText: "" });
    setProfile(null);
    setEnrichError(null);
    setBadgeImage(null);
    setPreview(null);
    setScanError(null);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-5 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Lanyard</h1>
        <p className="mt-1 text-sm text-neutral-500">Know who you&apos;re talking to.</p>
      </header>

      {/* The input is driven by a native <label>, not a JS .click(). Mobile browsers
          refuse to open the picker for a `display: none` input. */}
      <input
        ref={fileInput}
        id="badge-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="absolute h-px w-px overflow-hidden opacity-0"
      />

      {status === "idle" && (
        <>
          <label
            htmlFor="badge-input"
            className="block w-full cursor-pointer rounded-xl bg-neutral-900 px-6 py-4 text-center text-base font-medium text-white transition hover:bg-neutral-700 active:scale-[0.99] dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Scan a badge
          </label>
          {/* Not every badge is worth photographing, and some people have none. */}
          <button
            onClick={() => {
              setDraft({ ...EMPTY_EXTRACTION, rawText: "" });
              setStatus("review");
            }}
            className="mt-2 w-full text-center text-xs text-neutral-400 underline hover:text-neutral-700 dark:hover:text-neutral-200"
          >
            No badge? Type it in
          </button>
        </>
      )}

      {status === "scanning" && (
        <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-6 py-4 dark:border-neutral-800">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
          <span className="text-sm text-neutral-500">Reading the badge…</span>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-4 dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-sm font-medium text-red-900 dark:text-red-200">{scanError}</p>
          <button onClick={reset} className="mt-2 text-sm text-red-700 underline dark:text-red-300">
            Try again
          </button>
        </div>
      )}

      {status === "review" && (
        <div className="space-y-5">
          {/* Stage 2 first: the researched profile is the point of the app. */}
          {(enrichingPerson || enrichingCompanies) && !profile && (
            <div className="flex items-center gap-3 rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
              <span className="text-sm text-neutral-500">Researching {draft.name || "them"}…</span>
            </div>
          )}
          {profile && (
            <ProfileCard
              profile={profile}
              name={draft.name}
              company={draft.company}
              badgeLinkedin={draft.linkedin}
              loadingPerson={enrichingPerson}
              loadingCompanies={enrichingCompanies}
            />
          )}
          {/* Last year's badges carried only a name. With no company there's nothing to
              research, so ask for it directly rather than showing an empty card. */}
          {!enrichingPerson && !enrichingCompanies && !profile && !draft.company && (
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
              <p className="text-sm font-medium">
                {draft.name ? `Where does ${draft.name.split(" ")[0]} work?` : "Who did you meet?"}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                The badge didn&apos;t say. Add it and we can research them properly — you can
                always ask them.
              </p>
              <div className="mt-3 flex gap-2">
                {!draft.name && (
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Name"
                    className="w-1/2 rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-800 dark:focus:border-white"
                  />
                )}
                <input
                  value={draft.company}
                  onChange={(e) =>
                    setDraft({ ...draft, company: e.target.value, companies: [e.target.value] })
                  }
                  placeholder="Company"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draft.company) void runEnrichment(draft);
                  }}
                  className="flex-1 rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-800 dark:focus:border-white"
                />
                <button
                  onClick={() => void runEnrichment(draft)}
                  disabled={!draft.company && !draft.name}
                  className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
                >
                  Research
                </button>
              </div>
            </div>
          )}

          {/* Research can fail or find nothing; the LinkedIn lookup should still work. */}
          {!profile && !enrichingPerson && !enrichingCompanies && (draft.name || draft.company) && (
            <LinkedInButton
              profileUrl={draft.linkedin}
              name={draft.name}
              company={draft.company}
            />
          )}
          {enrichError && !profile && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Couldn&apos;t research this person: {enrichError}
            </p>
          )}

          {/* Stage 1: what was literally on the badge, editable. */}
          <details className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800" open={!profile}>
            <summary className="cursor-pointer text-xs uppercase tracking-wide text-neutral-500">
              From the badge
            </summary>
            <div className="mt-4 space-y-3">
              {(badgeImage || preview) && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={badgeImage ?? preview!}
                  alt="Captured badge"
                  className={
                    badgeImage
                      ? "w-full rounded-lg border border-neutral-200 object-contain dark:border-neutral-800"
                      : "h-28 w-full rounded-lg object-cover opacity-70"
                  }
                />
              )}
              {(["name", "title", "linkedin"] as const).map((field) => (
                <label key={field} className="block">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">{field}</span>
                  <input
                    value={draft[field]}
                    onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-800 dark:focus:border-white"
                  />
                </label>
              ))}

              {/* Badges can name several orgs or addresses. Render every one, editable, and
                  keep the singular `company`/`email` in sync with the first entry. */}
              {(["companies", "emails"] as const).map((field) => {
                const values = draft[field].length > 0 ? draft[field] : [""];
                const singular = field === "companies" ? "company" : "email";
                const update = (next: string[]) => {
                  const cleaned = next.map((v) => v.trim()).filter(Boolean);
                  setDraft({ ...draft, [field]: next, [singular]: cleaned[0] ?? "" });
                };
                return (
                  <div key={field}>
                    <span className="text-xs uppercase tracking-wide text-neutral-500">
                      {field === "companies" ? "company" : "email"}
                      {values.length > 1 && ` (${values.length})`}
                    </span>
                    <div className="mt-1 space-y-2">
                      {values.map((value, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            value={value}
                            onChange={(e) => {
                              const next = [...values];
                              next[i] = e.target.value;
                              update(next);
                            }}
                            className="w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-800 dark:focus:border-white"
                          />
                          {values.length > 1 && (
                            <button
                              onClick={() => update(values.filter((_, j) => j !== i))}
                              className="shrink-0 rounded-lg border border-neutral-200 px-2.5 text-sm text-neutral-400 hover:text-red-600 dark:border-neutral-800"
                              title="Remove"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => update([...values, ""])}
                        className="text-xs text-neutral-400 underline hover:text-neutral-700 dark:hover:text-neutral-200"
                      >
                        + add {field === "companies" ? "company" : "email"}
                      </button>
                    </div>
                  </div>
                );
              })}

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">
                  notes
                </span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={3}
                  placeholder="Where you met, what you talked about, what to follow up on…"
                  className="mt-1 w-full resize-y rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-800 dark:focus:border-white"
                />
              </label>
              {!draft.name && draft.rawText && (
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer">Couldn&apos;t read the fields — show raw text</summary>
                  <pre className="mt-2 whitespace-pre-wrap">{draft.rawText}</pre>
                </details>
              )}
              <button
                onClick={() => runEnrichment(draft)}
                disabled={enrichingPerson || enrichingCompanies}
                className="text-xs text-blue-600 underline disabled:opacity-40 dark:text-blue-400"
              >
                Re-run research with these details
              </button>
            </div>
          </details>

          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
            >
              Save contact
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <section className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-neutral-500">
            {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
          </h2>
          {contacts.length > 0 && (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-40 rounded-lg border border-neutral-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-800 dark:focus:border-white"
            />
          )}
        </div>

        {contacts.some((c) => c.priority) && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {([
              { v: "all", label: "All" },
              { v: "flagged", label: "Follow up" },
              ...PRIORITIES.map((p) => ({ v: p.value, label: p.label })),
            ] as const).map(({ v, label }) => (
              <button
                key={v}
                onClick={() => setFilter(v as Priority | "all" | "flagged")}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  filter === v
                    ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                    : "border-neutral-200 text-neutral-500 hover:border-neutral-400 dark:border-neutral-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {listError && <p className="text-sm text-red-600">{listError}</p>}
        {loading && <p className="text-sm text-neutral-400">Loading…</p>}

        {!loading && contacts.length === 0 && (
          <p className="rounded-xl border border-dashed border-neutral-200 px-6 py-10 text-center text-sm text-neutral-400 dark:border-neutral-800">
            No contacts yet. Scan a badge to get started.
          </p>
        )}

        <ul className="space-y-2">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-neutral-200 dark:border-neutral-800"
            >
              <button
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                className="w-full px-4 py-3 text-left"
              >
                <p className="flex items-center gap-2 font-medium">
                  {c.priority && (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        PRIORITIES.find((p) => p.value === c.priority)?.dot ?? ""
                      }`}
                      title={c.priority}
                    />
                  )}
                  {c.name || "Unknown"}
                </p>
                <p className="text-sm text-neutral-500">
                  {[c.title, c.company].filter(Boolean).join(" · ")}
                </p>
                {normalizeProfile(c.profile, c.company)?.person.headline && (
                  <p className="mt-1.5 text-sm text-neutral-400">
                    {normalizeProfile(c.profile, c.company)!.person.headline}
                  </p>
                )}
              </button>
              {expanded === c.id && normalizeProfile(c.profile, c.company) && (
                <div className="space-y-3 px-4 pb-4">
                  {c.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={c.imageUrl}
                      alt={`${c.name} badge`}
                      className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800"
                    />
                  )}
                  <ProfileCard
                    profile={normalizeProfile(c.profile, c.company)!}
                    name={c.name}
                    company={c.company}
                    badgeLinkedin={c.linkedin}
                  />

                  <ContactDetails contact={c} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-neutral-400">
                      Follow up
                    </span>
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.value}
                        onClick={() =>
                          uid && setPriority(uid, c.id, c.priority === p.value ? null : p.value)
                        }
                        className={`rounded-full border px-2.5 py-1 text-xs transition ${
                          c.priority === p.value
                            ? p.chip
                            : "border-neutral-200 text-neutral-400 hover:border-neutral-400 dark:border-neutral-700"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {confirmDelete === c.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          if (uid) await deleteContact(uid, c.id);
                          setConfirmDelete(null);
                        }}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Delete permanently
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs dark:border-neutral-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(c.id)}
                      className="text-xs text-neutral-400 underline hover:text-red-600"
                    >
                      Delete contact
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        {uid && <DevicePanel uid={uid} contacts={contacts} />}
      </section>
    </main>
  );
}
