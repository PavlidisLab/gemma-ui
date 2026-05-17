import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { formatNumber } from "@/lib/utils";

interface Props {
  page: number;
  pageSize: number;
  total: number;
  pageSizeOptions: number[];
  onChangePage: (p: number) => void;
  onChangePageSize: (s: number) => void;
}

export function Pager({ page, pageSize, total, pageSizeOptions, onChangePage, onChangePageSize }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gemma-subtle">Page size</span>
      <select
        value={pageSize}
        onChange={(e) => onChangePageSize(Number(e.target.value))}
        className="input py-0.5 w-auto"
      >
        {pageSizeOptions.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <span className="text-gemma-subtle tabular-nums">
        {formatNumber(start)}–{formatNumber(end)} of {formatNumber(total)}
      </span>
      <button className="btn btn-ghost" onClick={() => onChangePage(1)} disabled={page <= 1}>
        <ChevronsLeft className="h-4 w-4" />
      </button>
      <button className="btn btn-ghost" onClick={() => onChangePage(page - 1)} disabled={page <= 1}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="tabular-nums">{page} / {totalPages}</span>
      <button className="btn btn-ghost" onClick={() => onChangePage(page + 1)} disabled={page >= totalPages}>
        <ChevronRight className="h-4 w-4" />
      </button>
      <button className="btn btn-ghost" onClick={() => onChangePage(totalPages)} disabled={page >= totalPages}>
        <ChevronsRight className="h-4 w-4" />
      </button>
    </div>
  );
}
