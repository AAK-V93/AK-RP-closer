"use client";

import { useMemo, useState, type ReactNode } from "react";
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
  trailing,
}: {
  columns: SheetColumn<T>[];
  rows: T[];
  getId: (row: T) => string;
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  empty?: string;
  trailing?: {
    label: string;
    width: number;
    render: (row: T) => ReactNode;
  };
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const slice = useMemo(
    () => rows.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [rows, safePage, pageSize],
  );
  const minWidth = columns.reduce((sum, col) => sum + col.width, 0) + (trailing?.width || 0);

  const wide = minWidth > 720;
  return (
    <div className="w-full min-w-0 max-w-full space-y-2">
      {wide && (
        <p className="text-xs text-fg3">Desliza a la derecha para ver el resto de columnas.</p>
      )}
      <div
        className="w-full min-w-0 max-w-full overflow-x-scroll overflow-y-auto rounded-2xl border border-separator1 bg-bg1"
        style={{ maxHeight: "calc(100vh - 220px)", scrollbarWidth: "thin" }}
      >
        <table
          className="border-collapse text-[13px] leading-snug text-fg1"
          style={{ tableLayout: "fixed", width: minWidth, minWidth }}
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
            {trailing && <col style={{ width: trailing.width }} />}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="border-b border-separator1 bg-bg1 px-2 py-2 text-sm text-fg3 align-bottom"
                  style={{
                    minHeight: SHEET_ROW_PX,
                    textAlign: col.align || "left",
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    lineHeight: 1.25,
                  }}
                >
                  {col.label}
                </th>
              ))}
              {trailing && (
                <th
                  className="sticky right-0 z-20 border-b border-separator1 bg-bg1 px-2 text-sm text-fg3"
                  style={{ width: trailing.width, textAlign: "left" }}
                >
                  {trailing.label}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr style={{ height: SHEET_ROW_PX }}>
                <td
                  colSpan={columns.length + (trailing ? 1 : 0)}
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
                    style={{ cursor: onRowClick ? "pointer" : "default" }}
                  >
                    {columns.map((col) => {
                      const value = sheetCell(col.value(row));
                      return (
                        <td
                          key={col.key}
                          title={value === "—" ? undefined : value}
                          className="border border-separator1 px-2 py-1.5 align-top"
                          style={{
                            textAlign: col.align || "left",
                            fontVariantNumeric:
                              col.align === "right" ? "tabular-nums" : undefined,
                          }}
                        >
                          <div className="line-clamp-3 break-words [overflow-wrap:anywhere]">
                            {value}
                          </div>
                        </td>
                      );
                    })}
                    {trailing && (
                      <td
                        className={`sticky right-0 z-10 border border-separator1 px-2 py-1 align-top ${
                          selected ? "bg-primary/10" : index % 2 === 1 ? "bg-bg2" : "bg-bg1"
                        }`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {trailing.render(row)}
                      </td>
                    )}
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
