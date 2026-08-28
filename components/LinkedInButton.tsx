/**
 * Always renders something useful.
 *
 * If research turned up a profile URL we link straight to it. If it didn't —
 * which is the common case, since most attendees aren't findable — we link to a
 * LinkedIn people-search for their name and company instead. Both are https
 * links, so on mobile LinkedIn's universal-link handling opens the native app
 * when it's installed and falls back to the web when it isn't. A `linkedin://`
 * scheme would open the app too, but fails silently with no fallback when the
 * app is missing, which is worse.
 */
function normalize(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
}

function searchUrl(name: string, company: string): string {
  const keywords = [name, company].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

/** LinkedIn's company directory lives on a different path than people search. */
function companySearchUrl(company: string): string {
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}`;
}

export function LinkedInButton({
  profileUrl,
  name,
  company,
  variant = "person",
}: {
  profileUrl?: string;
  name: string;
  company: string;
  /** "person" searches people; "company" searches the company directory. */
  variant?: "person" | "company";
}) {
  const isCompany = variant === "company";
  if (isCompany ? !company : !name && !company && !profileUrl) return null;

  const direct = normalize(profileUrl ?? "");
  const href = isCompany ? companySearchUrl(company) : direct || searchUrl(name, company);
  const label = isCompany
    ? `${company} on LinkedIn`
    : direct
      ? "Open LinkedIn"
      : "Find on LinkedIn";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.99] ${
        isCompany
          ? "border border-[#0A66C2] text-[#0A66C2] hover:bg-[#0A66C2]/10"
          : "bg-[#0A66C2] text-white hover:bg-[#004182]"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.59 0 4.25 2.36 4.25 5.44v6.3zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
      </svg>
      <span className="truncate">{label}</span>
    </a>
  );
}
