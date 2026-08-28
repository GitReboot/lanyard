import type { Profile, Source } from "@/lib/types";
import { LinkedInButton } from "./LinkedInButton";

function Sources({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {sources.map((s, i) => (
        <a
          key={i}
          href={s.uri}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[150px] truncate rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:border-neutral-400 dark:border-neutral-700"
        >
          {s.title || "source"}
        </a>
      ))}
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-neutral-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-700 dark:border-t-neutral-300" />
      {label}…
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-neutral-400">
      {children}
    </p>
  );
}

/**
 * Two co-equal sections. The company half is the reliable one — most attendees
 * aren't findable online, but their employer almost always is — so the card
 * still says something useful when person research comes back empty.
 */
export function ProfileCard({
  profile,
  name,
  company,
  badgeLinkedin,
  loadingPerson = false,
  loadingCompanies = false,
}: {
  profile: Profile;
  name: string;
  company: string;
  /** LinkedIn printed on the badge, used when research didn't surface a verified one. */
  badgeLinkedin?: string;
  loadingPerson?: boolean;
  loadingCompanies?: boolean;
}) {
  const { person, companies } = profile;

  return (
    <div className="space-y-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/40">
      {/* ---------- Person ---------- */}
      <section>
        <SectionLabel>About the person</SectionLabel>

        {loadingPerson && !person.headline && <Pending label={`Researching ${name || "them"}`} />}

        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold leading-snug">
            {person.headline || name || "Unknown"}
          </p>
          {person.seniority && person.seniority !== "Unknown" && (
            <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white dark:bg-white dark:text-neutral-900">
              {person.seniority}
            </span>
          )}
        </div>

        {person.whatTheyDo && (
          <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
            {person.whatTheyDo}
          </p>
        )}

        {person.notable.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {person.notable.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                <span className="text-neutral-400">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}

        {person.pastCompanies.length > 0 && (
          <p className="mt-2 text-sm text-neutral-500">
            Previously {person.pastCompanies.join(", ")}
          </p>
        )}

        {!person.found && !loadingPerson && person.headline && (
          <p className="mt-2 text-xs text-neutral-400">
            Couldn&apos;t find this person online — the company details below are still researched.
          </p>
        )}

        <Sources sources={person.sources} />

        <div className="mt-3">
          <LinkedInButton
            profileUrl={person.linkedin || badgeLinkedin}
            name={name}
            company={company}
          />
        </div>
      </section>

      {/* ---------- Companies ---------- */}
      {loadingCompanies && companies.length === 0 && (
        <section className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <SectionLabel>About the company</SectionLabel>
          <Pending label={`Researching ${company || "the company"}`} />
        </section>
      )}

      {companies.length > 0 && (
        <section className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <SectionLabel>
            {companies.length > 1 ? `About the companies (${companies.length})` : "About the company"}
          </SectionLabel>

          <div className="space-y-4">
            {companies.map((co, idx) => (
              <div
                key={`${co.name}-${idx}`}
                /* Separate each org visually — these are distinct companies, not one story. */
                className={
                  idx > 0 ? "border-t border-dashed border-neutral-200 pt-4 dark:border-neutral-800" : ""
                }
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold">{co.name}</p>
                  {co.sizeStage && (
                    <span className="shrink-0 text-[11px] text-neutral-500">{co.sizeStage}</span>
                  )}
                </div>

                {co.whatItDoes && (
                  <p className="mt-1.5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                    {co.whatItDoes}
                  </p>
                )}

                {co.engineering && (
                  <p className="mt-2 border-l-2 border-neutral-300 pl-3 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                    <span className="font-medium text-neutral-500">Engineering — </span>
                    {co.engineering}
                  </p>
                )}

                <Sources sources={co.sources} />

                <div className="mt-3">
                  <LinkedInButton variant="company" name={name} company={co.name} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!profile.grounded && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Unverified — web search was unavailable, so this reflects general knowledge rather
          than researched facts.
        </p>
      )}
    </div>
  );
}
