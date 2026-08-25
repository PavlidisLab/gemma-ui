/**
 * Shared furniture for the home page's blocks and the plots popup.
 *
 * These live here because the two surfaces render the same shapes: a
 * hard-bordered frame, a small-caps header, a label/value row, a
 * horizontal bar row. The bar row in particular had drifted into three
 * near-identical copies (categories, perturbed genes, treatment
 * subcategories) that had to be kept in sync by hand — one row
 * component now backs all of them.
 */

import type React from "react";
import { Link } from "@tanstack/react-router";
import { Tooltip } from "@/components/ui/Tooltip";

/** The hard-bordered frame every home-page block sits in. */
export function Panel({
  children,
  minHeight = true,
}: {
  children: React.ReactNode;
  /** The floor that keeps two side-by-side panels on the home row from
   *  sitting at different heights. Off inside the plots popup, where
   *  each block is shown alone and the slack just reads as a gap. */
  minHeight?: boolean;
}) {
  return (
    <div className="flex flex-col h-full border border-stone-950 bg-stone-100">
      <div className={`flex-1 ${minHeight ? "min-h-[15rem]" : ""}`}>
        {children}
      </div>
    </div>
  );
}

/** Small-caps block header. ``unit`` is the right-hand hint naming what
 *  the numbers count; its tooltip carries the long explanation. */
export function PlotHeader({
  title,
  unit,
  unitHint,
}: {
  title: string;
  unit?: string;
  unitHint?: string;
}) {
  return (
    <div className="px-4 py-1.5 border-b border-stone-300 text-[10px] uppercase tracking-[0.2em] text-stone-600 flex items-baseline justify-between gap-2">
      <span className="text-stone-900 font-semibold">{title}</span>
      {unit ? (
        <span
          className="text-stone-500 normal-case tracking-normal text-[11px] truncate"
          title={unitHint}
        >
          {unit}
        </span>
      ) : null}
    </div>
  );
}

/** Where a row points when clicked. Omitted ⇒ the row renders as plain
 *  text, which is the honest rendering for a figure with no filter
 *  behind it. */
export interface RowLink {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
}

function LinkOrText({
  link,
  className,
  title,
  children,
}: {
  link?: RowLink;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  if (!link) {
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  }
  return (
    <Link
      to={link.to}
      params={link.params}
      search={link.search}
      title={title}
      className={`${className ?? ""} text-stone-800 hover:text-blue-700 hover:underline`}
    >
      {children}
    </Link>
  );
}

/** One horizontal bar: label, proportional bar, right-aligned count. */
export function BarRow({
  label,
  count,
  max,
  title,
  link,
  italic,
  footnote,
}: {
  label: string;
  count: number;
  max: number;
  title?: string;
  link?: RowLink;
  /** Gene symbols are set in italics, per the convention everywhere
   *  else in the app. */
  italic?: boolean;
  /** Muted second line under the bar — example terms, mostly. Lives
   *  inside the same <li> so the list stays a flat list. */
  footnote?: React.ReactNode;
}) {
  const pct = Math.max(0.5, (count / max) * 100);
  return (
    <li className="px-4 py-1 text-xs hover:bg-stone-50" title={title}>
      <div className="grid grid-cols-[11rem_minmax(0,1fr)_max-content] items-center gap-3">
        <LinkOrText
          link={link}
          title={title ?? label}
          className={`truncate ${italic ? "font-medium italic" : "text-stone-800"}`}
        >
          {label}
        </LinkOrText>
        <div className="h-1.5 bg-stone-200 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-blue-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-right tabular-nums text-stone-900 font-medium whitespace-nowrap">
          {count.toLocaleString()}
        </span>
      </div>
      {footnote ? (
        <div className="text-[11px] text-stone-500 truncate">{footnote}</div>
      ) : null}
    </li>
  );
}

/** One label / right-aligned-number table row. */
export function ValueRow({
  label,
  value,
  link,
  title,
  suffix,
}: {
  label: string;
  value: React.ReactNode;
  link?: RowLink;
  title?: string;
  /** Muted trailing note on the label side (e.g. "· 62M cells"). */
  suffix?: React.ReactNode;
}) {
  return (
    <tr className="border-t border-stone-200 first:border-t-0 hover:bg-stone-50">
      <td className="px-5 py-2 text-stone-800">
        <LinkOrText link={link} title={title}>
          {label}
        </LinkOrText>
        {suffix ? (
          <span className="ml-2 text-[11px] text-stone-500">{suffix}</span>
        ) : null}
      </td>
      <td className="px-5 py-2 text-right tabular-nums font-semibold text-stone-950">
        {value}
      </td>
    </tr>
  );
}

export function InfoBadge({
  hint,
  ariaLabel,
}: {
  /** Tooltip body. Accept ReactNode so callers can pass a rich
   *  layout (e.g. a small ranked list) for tiles that benefit from
   *  structured content. */
  hint: React.ReactNode;
  /** Plain-text fallback for screen readers + aria. Required when
   *  ``hint`` is a node; ignored otherwise. */
  ariaLabel?: string;
}) {
  const a11y = ariaLabel ?? (typeof hint === "string" ? hint : "more info");
  return (
    <Tooltip label={hint}>
      <span
        role="img"
        aria-label={a11y}
        tabIndex={0}
        className="ml-1.5 inline-flex items-center justify-center w-3 h-3 rounded-full border border-stone-400 text-stone-500 text-[8px] leading-none select-none normal-case tracking-normal font-medium hover:border-stone-700 hover:text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-600"
      >
        i
      </span>
    </Tooltip>
  );
}
