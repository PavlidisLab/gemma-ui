# `calibration_gold_only_miss` rationale flip + apply-disposition realignment

Filed 2026-05-08 from the GUI session.

## What the UI just changed

For `calibration_gold_only_miss` findings, the audit-sidebar
"Agree" button now removes the over-tagged term + dispositions
**accepted+resolved** (was previously: dismissed + curator_wrong).
The reasoning: clicking *Agree* on a finding should DO the
structural action the curator agrees with. With the previous
mapping, the curator clicked Agree (expecting deletion) and got a
disposition that's no-action; the explicit deletion was buried
behind a second affordance. Paul, verbatim:

> "when I click 'agree' with a curator deletion it should delete
> it; and the panel should grey out. and change from suggested to
> done or whatever."

UI also merged the standalone Agree button into the apply button
when an apply action is available — single click does the
structural fix + the disposition. Renamed
`Apply (add)`/`Apply (remove)` → `Agree (add)`/`Agree (remove)`
so the verb matches.

## What's now misaligned with the rationale text

Brother's question-form rationale today reads:

> Did the agent miss `X`?

…and the curator clicking Agree means "delete `X`". That's
*incoherent* under the literal reading: agreeing-the-agent-missed
shouldn't delete anything. The mapping only makes sense if the
question is about whether `X` should be removed.

## Ask

Rephrase the `calibration_gold_only_miss` rationale to a question
the new Agree-deletes mapping resolves cleanly. Suggested:

> Should `X` be removed from the curation? (the agent did not
> propose it.)

With the new rationale:

- Agree → "yes, remove" → UI runs the apply, which removes the
  tag + dispositions accepted+resolved. ✓
- Disagree → "no, keep it (the agent should have proposed it)"
  → curator picks a dismiss reason (`auditor_wrong` is the
  natural fit when the curator believes the agent erred by
  skipping; `other` for case-by-case).

## Eval-signal note

The disposition flip changes the eval-signal interpretation:

| State | Before flip | After flip |
|---|---|---|
| Agreed gold_only_miss (accepted+resolved) | n/a — agree was no-action | curator agrees gold over-tagged → positive signal for proposer prompts |
| Disagreed gold_only_miss (dismissed) | n/a — most curators didn't reach here | curator believes agent should have proposed it → negative signal for proposer prompts |
| Apply (remove) (was dismissed+curator_wrong) | curator says agent right; gold wrong → positive signal for proposer | now folded into the Agreed-accepted path above |

`curator_wrong` as a dismiss reason still applies for other
calibration findings (e.g. agent_extra dismissed because the
curator thinks gold over-tagged differently). It just stops being
the natural fit for gold_only_miss after this flip.

## Cross-repo compatibility

- Rationale text change: pure prose. No schema impact.
- Disposition mapping change: UI-side only. Older agents emit
  the old phrasing + the UI still routes to accepted+resolved
  (the rationale just reads slightly off, no functional break).

No `MIN_UI_VERSION` bump.
