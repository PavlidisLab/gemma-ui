/**
 * Who has this experiment open.
 *
 * gembro's §5: `Editing · you`, or
 * `Alice is editing — last change 4 min ago · [Take over]`.
 *
 * 🛑 **The CHIP never gates** — it renders, and nothing here disables
 * an action. The LEASE does: `CommitBar` blocks COMMIT while a
 * different identity holds it (`0df972b`), and Gemma refuses the write
 * server-side with a 409 `LOCK_REQUIRED` naming the holder
 * (`2acff27319`). This block used to end *"nothing downstream may
 * start reading a held lock as permission"* — that described the
 * advisory era and is now false. Do not restore it.
 *
 * 🛑 What SURVIVED that reversal: `baseline.lastModified` is still the
 * correctness guarantee and its 409 still has to be handled. A held
 * lock makes a write PERMITTED, never SAFE — it does not mean the row
 * underneath you stood still. Dropping the baseline check because
 * "the lock handles it now" is the bug.
 *
 * Taking over is offered without ceremony because it costs nothing:
 * the other curator's draft is a separate row and survives. What they
 * lose is the lease, and their next commit 409s on a stale baseline
 * and they re-sync — the protection everyone already has.
 *
 * The relative time carries more than the TTL does. A 30-minute expiry
 * cannot tell you whether someone stepped out or is mid-sentence;
 * "last change 26 min ago" lets a human decide, and a human deciding
 * is the whole design (gembro: the TTL is a UI-honesty knob, not a
 * safety one).
 */

import { lockHolderPhrase, type CurationLock } from "@/api/curationLock";

/** "4 min ago" / "just now". Minutes, because the question this
 *  answers is "has this person stepped away", and that is not a
 *  seconds-scale question. Exported for test. */
export function relativeSince(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((now.getTime() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return "1 hr ago";
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function LockChip({
  lock,
  me,
  onTakeOver,
  busy,
}: {
  lock: CurationLock | null;
  /** The current curator's username. */
  me: string | null;
  onTakeOver?: () => void;
  busy?: boolean;
}) {
  // Nothing to say when nobody holds it. An unlocked experiment is the
  // ordinary case and does not need a chip explaining that it is
  // ordinary.
  if (!lock || !lock.locked) return null;

  const base = "text-[11px] leading-snug inline-flex items-center gap-1.5";
  const mine = !!me && lock.locked_by === me;

  if (mine) {
    // 🛑 This renders for the WHOLE session on every experiment, since
    // the UI takes the lease on open. Kept deliberately (Paul,
    // 2026-08-26: "let's just show it, for debugging purposes if
    // nothing else") — it is the only visible evidence the lease
    // mechanism is working at all, and without it the first time
    // anyone sees a lock is when someone else has one.
    //
    // The argument against, so it is not re-litigated from scratch:
    // it says what the curator already knows, and a row that is always
    // populated trains people to stop reading it — including the save
    // indicator beside it. If that turns out to be the real cost,
    // dropping this branch is the change; silence already means "it is
    // yours" everywhere else in this row.
    return (
      <span
        className={`${base} text-slate-500 dark:text-slate-400`}
        title={
          lock.stolen_from
            ? `You took this from ${lock.stolen_from}`
            : "You hold the editing lease on this experiment"
        }
      >
        Editing · you
      </span>
    );
  }

  // Someone else. Name them when the server said who — and say the
  // vaguer thing rather than guess when it did not.
  // One phrase source across the chip, the dashboard panel and the
  // experiment list — see `lockHolderPhrase`. A batch and a person are
  // different answers to "should I wait or take over", so they must not
  // read alike.
  const { who, kind, detail } = lockHolderPhrase(lock);
  const since = relativeSince(lock.locked_at);
  // "is editing" is a person at a keyboard; a batch is not editing, it
  // is working through a run. Saying "editing" of a job invites the
  // curator to wait for someone to finish a sentence.
  const verb = kind === "batch" ? "is curating" : "is editing";

  return (
    <span className={`${base} text-amber-800 dark:text-amber-300`}>
      <span title={detail ? `Run: ${detail}` : undefined}>
        {who} {verb}
        {since ? ` — last change ${since}` : ""}
      </span>
      {onTakeOver ? (
        <button
          type="button"
          onClick={onTakeOver}
          disabled={busy}
          title={`Take the editing lease from ${who}. Their work is not affected — their draft is separate and survives.`}
          className="underline hover:no-underline disabled:opacity-50"
        >
          {busy ? "Taking over…" : "Take over"}
        </button>
      ) : null}
    </span>
  );
}
