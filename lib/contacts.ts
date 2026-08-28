"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { getDb, ensureUser } from "./firebase";
import type { Contact, ExtractedContact, Priority, Profile } from "./types";

function contactsRef(uid: string) {
  return collection(getDb(), "users", uid, "contacts");
}

export async function saveContact(
  uid: string,
  extracted: ExtractedContact & { rawText?: string; quad?: unknown },
  profile: Profile | null,
  /** Deskewed badge crop as a JPEG data URL (~30KB), stored inline in the doc. */
  imageUrl: string | null = null,
) {
  const { rawText = "", quad: _quad, ...fields } = extracted;
  return addDoc(contactsRef(uid), {
    ...fields,
    rawText,
    profile,
    imageUrl,
    metAt: "DevFest DC 2026",
    createdAt: serverTimestamp(),
  });
}

/** Follow-up priority doubles as the "flag" — any value means flagged. */
export async function setPriority(uid: string, id: string, priority: Priority | null) {
  return updateDoc(doc(getDb(), "users", uid, "contacts", id), { priority });
}

export async function deleteContact(uid: string, id: string) {
  return deleteDoc(doc(getDb(), "users", uid, "contacts", id));
}

const EXPORT_VERSION = 1;

/**
 * Anonymous auth is per-device, so contacts can't roam on their own.
 * Export/import is the transfer mechanism between phones and laptops.
 */
export function exportContacts(contacts: Contact[]): string {
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: contacts.length,
      contacts: contacts.map(({ id, createdAt, ...rest }) => ({
        ...rest,
        // Timestamps don't survive JSON; keep millis so ordering is preserved on import.
        createdAtMs: createdAt?.toMillis?.() ?? null,
      })),
    },
    null,
    2,
  );
}

export function downloadContacts(contacts: Contact[]) {
  const blob = new Blob([exportContacts(contacts)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lanyard-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

/** Key used to avoid re-adding the same person when an export is imported twice. */
function identity(c: { name?: string; company?: string; email?: string }) {
  return `${c.name ?? ""}|${c.company ?? ""}|${c.email ?? ""}`.toLowerCase().trim();
}

export async function importContacts(
  uid: string,
  json: string,
  existing: Contact[],
): Promise<ImportResult> {
  const parsed = JSON.parse(json);
  const incoming = Array.isArray(parsed) ? parsed : parsed?.contacts;
  if (!Array.isArray(incoming)) {
    throw new Error("That file doesn't look like a Lanyard export.");
  }

  const seen = new Set(existing.map(identity));
  const batch = writeBatch(getDb());
  let imported = 0;
  let skipped = 0;

  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const key = identity(raw);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    const { createdAtMs, id: _ignored, ...rest } = raw;
    batch.set(doc(contactsRef(uid)), {
      ...rest,
      createdAt:
        typeof createdAtMs === "number" ? Timestamp.fromMillis(createdAtMs) : serverTimestamp(),
    });
    imported++;
  }

  await batch.commit();
  return { imported, skipped };
}

/** Signs in anonymously, then streams this user's contacts in realtime. */
export function useContacts() {
  const [uid, setUid] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    ensureUser()
      .then((user) => {
        setUid(user.uid);
        unsub = onSnapshot(
          query(contactsRef(user.uid), orderBy("createdAt", "desc")),
          (snap) => {
            setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Contact));
            setLoading(false);
          },
          (err) => {
            setError(err.message);
            setLoading(false);
          },
        );
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });

    return () => unsub?.();
  }, []);

  return { uid, contacts, loading, error };
}
