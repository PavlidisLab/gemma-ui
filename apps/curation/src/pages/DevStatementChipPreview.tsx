/**
 * Dev-only preview gallery for the StatementChip component.
 * Mirrors /tmp/statement-chip-preview.html (the design mockup) but
 * uses the real <StatementChip>, real <Term>, real CURIE popover, so
 * we iterate on typography against the actual component.
 *
 * Mount at: ``#/dev/statement-chip``.
 *
 * No data fetching — pure fixture. Drop / extend the fixtures inline
 * as new edge cases come up.
 */
import { useState } from "react";
import { StatementChip } from "@/components/ui/StatementChip";
import { StatementEditModal, type StatementDraft } from "@/components/ui/StatementEditModal";
import type { OntologyTerm } from "@/features/experiment/types";

function term(label: string, uri?: string | null): OntologyTerm {
  return { label, uri: uri ?? null };
}

const PRED = {
  derivesFromPartOf: term(
    "derives from part of",
    "http://purl.obolibrary.org/obo/ENVO_01003004",
  ),
  hasModifier: term(
    "has modifier",
    "http://purl.obolibrary.org/obo/RO_0002573",
  ),
  deliveredAtDose: term(
    "delivered at dose",
    "http://gemma.msl.ubc.ca/ont/TGEMO_00166",
  ),
  deliveredForDuration: term(
    "delivered for duration",
    "http://gemma.msl.ubc.ca/ont/TGEMO_00167",
  ),
};

const SUBJECTS = {
  liver: term("liver", "http://purl.obolibrary.org/obo/UBERON_0002107"),
  fibroblast: term("fibroblast", "http://purl.obolibrary.org/obo/CL_0000057"),
  kidney: term("kidney", "http://purl.obolibrary.org/obo/UBERON_0002113"),
  leftKidney: term(
    "left kidney",
    "http://purl.obolibrary.org/obo/UBERON_0004538",
  ),
  left: term("left", "http://purl.obolibrary.org/obo/PATO_0000366"),
  dexamethasone: term(
    "dexamethasone",
    "http://purl.obolibrary.org/obo/CHEBI_41879",
  ),
  vehicleControl: term("vehicle control"),
  tenMgKg: term("10 mg/kg"),
  sevenDays: term("7 days"),
};

const CATS = {
  organismPart: term(
    "organism part",
    "http://www.ebi.ac.uk/efo/EFO_0000635",
  ),
  cellType: term("cell type", "http://purl.obolibrary.org/obo/CL_0000000"),
  treatment: term("treatment", "http://www.ebi.ac.uk/efo/EFO_0000727"),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{title}</h3>
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4 space-y-2">
        {children}
      </div>
    </section>
  );
}

function SizeRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] text-slate-500 min-w-[110px]">
        {label}
      </span>
      {children}
    </div>
  );
}

export function DevStatementChipPreview() {
  const [editOpen, setEditOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<StatementDraft | null>(null);
  const initial: StatementDraft = {
    category: CATS.cellType,
    subject: SUBJECTS.fibroblast,
    pairs: [
      { predicate: PRED.derivesFromPartOf, object: SUBJECTS.kidney },
      { predicate: PRED.hasModifier, object: SUBJECTS.left },
    ],
  };
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-lg font-semibold">StatementChip — dev preview</h1>
          <p className="text-sm text-slate-400 mt-1">
            Real component, real <code className="text-slate-300">Term</code>,
            real CURIE popover. Hover any chip for the category tooltip.
            Click any CURIE to open the term popover.
          </p>
          <p className="text-xs text-slate-500 mt-2 font-mono">
            #/dev/statement-chip
          </p>
        </header>

        <Section title="0. Size variants — compact / default / comfortable">
          <SizeRow label="size: compact">
            <StatementChip
              size="compact"
              category={CATS.cellType}
              subject={SUBJECTS.fibroblast}
              pairs={[
                { predicate: PRED.derivesFromPartOf, object: SUBJECTS.kidney },
                { predicate: PRED.hasModifier, object: SUBJECTS.left },
              ]}
            />
          </SizeRow>
          <SizeRow label="size: default">
            <StatementChip
              size="default"
              category={CATS.cellType}
              subject={SUBJECTS.fibroblast}
              pairs={[
                { predicate: PRED.derivesFromPartOf, object: SUBJECTS.kidney },
                { predicate: PRED.hasModifier, object: SUBJECTS.left },
              ]}
            />
          </SizeRow>
          <SizeRow label="size: comfortable">
            <StatementChip
              size="comfortable"
              category={CATS.cellType}
              subject={SUBJECTS.fibroblast}
              pairs={[
                { predicate: PRED.derivesFromPartOf, object: SUBJECTS.kidney },
                { predicate: PRED.hasModifier, object: SUBJECTS.left },
              ]}
            />
          </SizeRow>
        </Section>

        <Section title="1. Subject-only tag (flat Characteristic)">
          <StatementChip
            category={CATS.organismPart}
            subject={SUBJECTS.liver}
          />
        </Section>

        <Section title="2. Subject + S-P-O with ontology object">
          <StatementChip
            category={CATS.cellType}
            subject={SUBJECTS.fibroblast}
            pairs={[
              {
                predicate: PRED.derivesFromPartOf,
                object: SUBJECTS.leftKidney,
              },
            ]}
          />
          <p className="text-xs text-slate-500 italic">
            "left kidney" exists as one UBERON term (UBERON:0004538) — the
            natural rendering keeps it as one ontology object.
          </p>
        </Section>

        <Section title="3. Subject + S-P-O-P-O — decomposed form (laterality as a qualifier)">
          <StatementChip
            category={CATS.cellType}
            subject={SUBJECTS.fibroblast}
            pairs={[
              { predicate: PRED.derivesFromPartOf, object: SUBJECTS.kidney },
              { predicate: PRED.hasModifier, object: SUBJECTS.left },
            ]}
          />
          <p className="text-xs text-slate-500 italic">
            Useful when laterality needs to be a filterable facet on the
            browser side rather than baked into the anatomy term.
          </p>
        </Section>

        <Section title="4. Subject + S-P-O-P-O — quantitative drug case">
          <StatementChip
            category={CATS.treatment}
            subject={SUBJECTS.dexamethasone}
            pairs={[
              { predicate: PRED.deliveredAtDose, object: SUBJECTS.tenMgKg },
              {
                predicate: PRED.deliveredForDuration,
                object: SUBJECTS.sevenDays,
              },
            ]}
          />
          <p className="text-xs text-slate-500 italic">
            Free-text objects (no CURIE) sit naturally next to ontology
            subjects — italic slate vs emerald reads cleanly.
          </p>
        </Section>

        <Section title="5. Free-text subject (no ontology resolution)">
          <StatementChip
            category={CATS.treatment}
            subject={SUBJECTS.vehicleControl}
            pairs={[
              {
                predicate: PRED.deliveredForDuration,
                object: SUBJECTS.sevenDays,
              },
            ]}
          />
        </Section>

        <Section title="6. Mixed wrap test — many chips in flow">
          <div className="flex flex-wrap gap-2">
            <StatementChip category={CATS.organismPart} subject={SUBJECTS.liver} />
            <StatementChip
              category={CATS.cellType}
              subject={SUBJECTS.fibroblast}
              pairs={[
                { predicate: PRED.derivesFromPartOf, object: SUBJECTS.leftKidney },
              ]}
            />
            <StatementChip
              category={CATS.treatment}
              subject={SUBJECTS.dexamethasone}
              pairs={[
                { predicate: PRED.deliveredAtDose, object: SUBJECTS.tenMgKg },
                { predicate: PRED.deliveredForDuration, object: SUBJECTS.sevenDays },
              ]}
            />
            <StatementChip category={CATS.treatment} subject={SUBJECTS.vehicleControl} />
          </div>
        </Section>

        <Section title="7. Click to open edit modal">
          <StatementChip
            category={CATS.cellType}
            subject={SUBJECTS.fibroblast}
            pairs={[
              { predicate: PRED.derivesFromPartOf, object: SUBJECTS.kidney },
              { predicate: PRED.hasModifier, object: SUBJECTS.left },
            ]}
            onClick={() => setEditOpen(true)}
          />
          <p className="text-xs text-slate-500 italic">
            Subject + object cells are scaffold inputs (label + URI); real
            wiring swaps to <code className="text-slate-300">OntologyTermPicker</code>.
            Predicate is locked to the Gemma allow-list.
          </p>
          {lastSaved ? (
            <div className="text-xs text-slate-400 mt-2">
              Last saved draft (logged to console):
              <pre className="text-[10px] mt-1 text-slate-500 overflow-auto">
                {JSON.stringify(lastSaved, null, 2)}
              </pre>
            </div>
          ) : null}
        </Section>
      </div>

      <StatementEditModal
        open={editOpen}
        initial={initial}
        onCancel={() => setEditOpen(false)}
        onSave={(next) => {
          setLastSaved(next);
          console.log("StatementEditModal saved:", next);
          setEditOpen(false);
        }}
      />
    </div>
  );
}
