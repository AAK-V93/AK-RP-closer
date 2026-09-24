"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

export const SHEET_PAGE_SIZE = 100;
export const SHEET_ROW_PX = 38;

export type SheetColumn<T> = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
  value: (row: T) => string | number | null | undefined;
};

export function sheetCell(value: string | number | null | undefined) {
  if (value == null) return "—";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || "—";
}

export function SheetTable<T>({
  columns,
  rows,
  getId,
  selectedId,
  onRowClick,
  pageSize = SHEET_PAGE_SIZE,
  empty = "Sin filas.",
}: {
  columns: SheetColumn<T>[];
  rows: T[];
  getId: (row: T) => string;
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  empty?: string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const slice = useMemo(
    () => rows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [rows, safePage, pageSize],
  );
  const minWidth = columns.reduce((sum, col) => sum + col.width, 0);

  return (
    <div className="space-y-2">
      <div
        className="overflow-auto rounded-2xl border border-separator1 bg-bg1"
        style={{ maxHeight: "calc(100vh - 220px)" }}
      >
        <table
          className="border-collapse text-[13px] leading-[38px] text-fg1"
          style={{ tableLayout: "fixed", width: minWidth, minWidth }}
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr style={{ height: SHEET_ROW_PX }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="border border-separator1 bg-bg2 px-2 text-[11px] font-semibold uppercase tracking-wide text-fg3"
                  style={{
                    height: SHEET_ROW_PX,
                    textAlign: col.align || "left",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr style={{ height: SHEET_ROW_PX }}>
                <td
                  colSpan={columns.length}
                  className="border border-separator1 px-2 text-fg3"
                  style={{ height: SHEET_ROW_PX }}
                >
                  {empty}
                </td>
              </tr>
            ) : (
              slice.map((row, index) => {
                const id = getId(row);
                const selected = selectedId === id;
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={
                      selected
                        ? "bg-primary/10"
                        : index % 2 === 1
                          ? "bg-bg2"
                          : "bg-bg1"
                    }
                    style={{
                      height: SHEET_ROW_PX,
                      cursor: onRowClick ? "pointer" : "default",
                    }}
                  >
                    {columns.map((col) => {
                      const value = sheetCell(col.value(row));
                      return (
                        <td
                          key={col.key}
                          title={value === "—" ? undefined : value}
                          className="border border-separator1 px-2"
                          style={{
                            height: SHEET_ROW_PX,
                            maxHeight: SHEET_ROW_PX,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: col.align || "left",
                            fontVariantNumeric:
                              col.align === "right" ? "tabular-nums" : undefined,
                          }}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <div className="flex items-center gap-2 text-xs text-fg3">
          <Button
            size="sm"
            variant="outline"
            disabled={safePage <= 0}
            onClick={() => setPage((n) => Math.max(0, n - 1))}
          >
            Anterior
          </Button>
          <span>
            Página {safePage + 1} / {totalPages} · {rows.length} filas
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((n) => Math.min(totalPages - 1, n + 1))}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
