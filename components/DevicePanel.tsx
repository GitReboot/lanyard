"use client";

import { useRef, useState } from "react";
import { downloadContacts, importContacts } from "@/lib/contacts";
import type { Contact } from "@/lib/types";

/**
 * Contacts live under an anonymous per-device uid, so they don't roam between
 * devices. That's worth surfacing, but it isn't worth a large panel — it's
 * housekeeping, not the point of the app. Collapsed to one row by default.
 */
export function DevicePanel({ uid, contacts }: { uid: string; contacts: Contact[] }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const { imported, skipped } = await importContacts(uid, await file.text(), contacts);
      setStatus(
        skipped > 0
          ? `Imported ${imported}, skipped ${skipped} already here.`
          : `Imported ${imported} contact${imported === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <section className="mt-8 border-t border-neutral-200 pt-3 dark:border-neutral-800">
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 hover:text-neutral-600 dark:hover:text-neutral-300"
          title={`Full device ID: ${uid}`}
        >
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          <span>
            Device ID: <span className="font-mono text-neutral-500">{uid.slice(0, 8)}</span>
          </span>
        </button>

        <span className="flex-1" />

        <button
          onClick={() => downloadContacts(contacts)}
          disabled={contacts.length === 0}
          className="hover:text-neutral-700 disabled:opacity-40 dark:hover:text-neutral-200"
        >
          Export
        </button>
        <span className="text-neutral-300 dark:text-neutral-700">·</span>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="hover:text-neutral-700 disabled:opacity-40 dark:hover:text-neutral-200"
        >
          {busy ? "Importing…" : "Import"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
          className="hidden"
        />
      </div>

      {open && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-400">
          Contacts are stored against this device only. Export to move them to another phone or
          laptop, or to back them up before the day ends. Importing merges and skips duplicates.
        </p>
      )}

      {status && <p className="mt-2 text-xs text-neutral-500">{status}</p>}
    </section>
  );
}
