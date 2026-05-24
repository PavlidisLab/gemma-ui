/**
 * Render an `OntologyTerm` as either:
 *  - a link to `term.uri` (opens in a new tab) when `uri` is set, or
 *  - a plain span otherwise.
 *
 * Spec §5.3 — used by the heatmap side panel for statement triples
 * and factor metadata. Kept browser-local so we don't cross-app
 * import the curation-side picker.
 */
import type { CSSProperties } from 'react';

export interface OntologyTermShape {
  label: string;
  uri?: string | null;
}

export interface OntologyTermLinkProps {
  term: OntologyTermShape;
  className?: string;
  style?: CSSProperties;
  /** Italicise the label (e.g. for unresolved / free-text terms). */
  italic?: boolean;
}

export function OntologyTermLink({
  term,
  className,
  style,
  italic = false,
}: OntologyTermLinkProps): JSX.Element {
  const text = term.label || '(unlabelled)';
  const baseStyle: CSSProperties = {
    fontStyle: italic ? 'italic' : 'normal',
    ...style,
  };
  if (term.uri) {
    return (
      <a
        className={className}
        href={term.uri}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#2563eb', textDecoration: 'none', ...baseStyle }}
        title={term.uri}
      >
        {text}
      </a>
    );
  }
  return (
    <span className={className} style={baseStyle}>
      {text}
    </span>
  );
}
