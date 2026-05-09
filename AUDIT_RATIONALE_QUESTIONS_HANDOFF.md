# Audit-finding rationales: phrase as questions

Filed 2026-05-08 from the GUI session.

## Symptom

Curators reading audit-finding cards saw rationales like:

> Agent proposed `genotype: Foxp3 wild type` but the existing
> curation does not have it.

…and then `Agree` / `Disagree…` / `Not sure` buttons. The
rationale is a *statement of fact*; the curator's verdict is
implicit. Paul's note (verbatim):

> "the phrasing is not a question. It should be 'Should you add
> the term <bla>' not 'agent suggests…'. The grammar is
> unnecessarily incomplete."

The disposition buttons resolve a question, but the rationale
doesn't ask one — Agree-with-what is left for the curator to
infer.

## Ask

Phrase rationales explicitly as the question the disposition
buttons answer. Per issue type, suggested rewrites:

| issue_code | today | suggested |
|---|---|---|
| `calibration_agent_extra` | "Agent proposed `cat: val` but the existing curation does not have it." | "Should the curation add the term `cat: val`?" |
| `calibration_gold_only_miss` | "Existing curation has `cat: val` but the agent did not propose it." | "Did the agent miss `cat: val`?" |
| `calibration_match` | "Agent and existing curation both have `cat: val`." | "Is the term `cat: val` correctly assigned?" |
| `forbidden_efc` | "Factor 'cat' is forbidden under §X." | "Should the factor 'cat' be removed (forbidden under §X)?" |
| `missing_baseline` | "Factor 'cat' has N FVs but none is marked as baseline." | "Should an FV be marked as baseline for 'cat'? Suggested: '<vehicle>'." |
| `ungrounded_term` | "Tag value '<bla>' has no ontology URI." | "Should '<bla>' resolve to <UBERON_X>?" |
| `low_confidence_assignment` | "Sample <gsm> is assigned to FV '<x>' but its characteristics list '<y>'." | "Should sample <gsm> be reassigned to FV '<y>'?" |

Pattern: name the proposed action + the specific term inline, end
with "?". The curator's Agree / Disagree then maps cleanly:
Agree = yes do that, Disagree = no don't.

## Why this matters

- **Grammar.** Statement-form rationales force the curator to
  reconstruct the question before answering. On a 30-finding
  calibration set that's 30 reconstructions.
- **Disambiguation.** "Agree" with a *statement* doesn't say what
  the curator is agreeing to — the existence of the situation? The
  agent's framing? "Agree" with a *question* is unambiguous.
- **Eval signal.** Disposition counts feed prompt-tuning. If
  curators interpret "Agree" inconsistently because the rationale
  is unclear, the signal is noisy. Question-form rationales make
  the verdict semantics tighter.

## UI side — no change needed

The card already renders the rationale as the primary text and
Agree / Disagree / Not sure as the verdict buttons. Once the
agent emits question-form rationales, the existing layout reads
correctly.

If brother wants a UI assist while the agent template is being
rewritten, I can ship a small `rationaleToQuestion(rationale,
issue_code)` helper that pattern-matches the known statement
shapes and rewrites them client-side. Less robust than fixing the
template; useful as a bridge if you want one.

## Cross-repo compatibility

Pure prose change. No schema impact. Older rationales render fine
under the new buttons (just less crisp); new rationales render
even better.
