import type { Contact } from "@/lib/types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <div className="min-w-0 flex-1 text-sm text-neutral-700 dark:text-neutral-200">{children}</div>
    </div>
  );
}

/**
 * What was captured from the badge, shown on a saved contact. The research card
 * covers who they are; this is the raw contact detail you actually need later —
 * every email, every company, and your own notes.
 */
export function ContactDetails({ contact }: { contact: Contact }) {
  // Older contacts predate the list fields, so fall back to the singular values.
  const emails = contact.emails?.length ? contact.emails : [contact.email].filter(Boolean);
  const companies = contact.companies?.length
    ? contact.companies
    : [contact.company].filter(Boolean);

  const hasAnything =
    emails.length > 0 || companies.length > 0 || contact.title || contact.linkedin || contact.notes;
  if (!hasAnything) return null;

  return (
    <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-neutral-400">
        Contact details
      </p>

      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {contact.title && <Row label="Title">{contact.title}</Row>}

        {companies.length > 0 && (
          <Row label={companies.length > 1 ? "Companies" : "Company"}>
            {companies.join(" · ")}
          </Row>
        )}

        {emails.length > 0 && (
          <Row label={emails.length > 1 ? "Emails" : "Email"}>
            <div className="space-y-0.5">
              {emails.map((e) => (
                <a key={e} href={`mailto:${e}`} className="block truncate text-blue-600 dark:text-blue-400">
                  {e}
                </a>
              ))}
            </div>
          </Row>
        )}

        {contact.linkedin && <Row label="LinkedIn">{contact.linkedin}</Row>}

        {contact.notes && (
          <Row label="Notes">
            <p className="whitespace-pre-wrap leading-relaxed text-neutral-600 dark:text-neutral-300">
              {contact.notes}
            </p>
          </Row>
        )}

        {contact.metAt && <Row label="Met at">{contact.metAt}</Row>}
      </div>
    </div>
  );
}
