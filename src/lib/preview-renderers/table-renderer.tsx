// Tabular data preview renderer for CSV and TSV documents.
// Provides search filtering across all columns, pagination for large datasets,
// sticky headers, and copy-to-clipboard support.

"use client";

import { Check, Copy, Search } from "lucide-react";
import { useMemo, useState } from "react";

interface TablePreviewData {
  format: "csv" | "tsv";
  headers: string[];
  rows: string[][];
  source: string;
}

const PAGE_SIZE = 50;

function TableHeader({
  format,
  totalRows,
  columnCount,
  query,
  onQueryChange,
  onCopy,
  copied,
}: {
  format: string;
  totalRows: number;
  columnCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-primary">
          {format}
        </span>
        <span className="text-muted-foreground">
          {totalRows.toLocaleString()} rows · {columnCount} cols
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter cells…"
            className="h-7 w-40 rounded border border-border bg-background pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-xs hover:bg-muted transition-colors"
          title="Copy raw data"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

function TablePagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <span>
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function TableGrid({
  headers,
  rows,
  startOffset,
}: {
  headers: string[];
  rows: string[][];
  startOffset: number;
}) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-left text-xs font-mono">
        <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 shadow-sm backdrop-blur">
          <tr>
            <th className="w-12 border-r border-border p-2 text-center text-[10px] text-muted-foreground font-semibold">
              #
            </th>
            {headers.map((h, i) => (
              <th key={i} className="border-r border-border p-2 font-semibold text-foreground">
                {h || `Col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className="hover:bg-muted/30 transition-colors">
              <td className="w-12 border-r border-border p-2 text-center text-[10px] text-muted-foreground">
                {startOffset + rIdx + 1}
              </td>
              {headers.map((_, cIdx) => (
                <td key={cIdx} className="max-w-xs truncate border-r border-border p-2" title={row[cIdx] ?? ""}>
                  {row[cIdx] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableRenderer({ preview }: { preview: TablePreviewData }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return preview.rows;
    const lower = query.toLowerCase();
    return preview.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(lower)));
  }, [preview.rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIndex, startIndex + PAGE_SIZE);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(preview.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <TableHeader
        format={preview.format}
        totalRows={preview.rows.length}
        columnCount={preview.headers.length}
        query={query}
        onQueryChange={(q) => {
          setQuery(q);
          setPage(1);
        }}
        onCopy={handleCopy}
        copied={copied}
      />
      <TableGrid headers={preview.headers} rows={pageRows} startOffset={startIndex} />
      <TablePagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
