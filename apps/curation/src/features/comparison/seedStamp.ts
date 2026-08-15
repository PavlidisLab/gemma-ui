import type { CurationRow } from "./useSourceAvailability";

/** Version stamp for the curation a draft sits on top of — the
 *  answer to "WHICH gold am I curating on top of?".
 *
 *  Two curators working the same ticket, or the same curator a week
 *  apart, can be seeded from different gold and the chip label
 *  ("Gold polished") reads identically either way. The stamp is the
 *  part that differs.
 *
 *  A content sha wins when the wire carries one — it survives a
 *  re-ingest that didn't change the content, which a timestamp does
 *  not. Otherwise the row's ``created_at``.
 *
 *  Both fields land on polished rows as of 2026-08-15 — ``created_at``
 *  from ``polished_designs.ingested_at`` and ``metadata.content_sha``,
 *  a sha256 over the stored payload, so an identical re-ingest keeps
 *  its sha while the timestamp moves. The wire carries the full 64-char
 *  digest; the 7 characters here are ours.
 *
 *  Still tolerates null: rows predating the stamp carry neither, and a
 *  missing one has to read as unknown rather than recent. */
export function seedStamp(row: CurationRow | null | undefined): string | null {
  const sha = row?.metadata?.["content_sha"];
  if (typeof sha === "string" && sha.trim()) return sha.trim().slice(0, 7);
  return formatSeedDate(row?.created_at);
}

/** Compact date — "Aug 13", with the year only when it isn't the
 *  current one. A seed from a previous year reading as a bare
 *  "Aug 13" would be read as recent. */
export function formatSeedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
