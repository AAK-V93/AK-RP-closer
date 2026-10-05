"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { WhenChip } from "@/components/inicio-home";
import {
  CRM_BOARD_BUCKETS,
  CRM_HOY_CAP,
  hoyMoreCount,
  type CrmBoard,
  type CrmBoardBucket,
  type CrmBoardPeriod,
  type CrmBoardPerson,
} from "@/lib/crm-board";

const LIST_CAP = 10;

const BUCKET_LABEL: Record<CrmBoardBucket, string> = {
  cerrados: "Cerrados",
  seguimiento: "En seguimiento",
  perdidos: "Perdidos",
};

const PILL =
  "inline-flex h-11 min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium";
const SELECT =
  "h-11 min-h-11 rounded-full border border-separator2 bg-bg1 px-3 text-sm text-fg0";

function PersonCell({ person }: { person: CrmBoardPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg2 text-[12px] font-semibold text-fg2"
      >
        {person.initials}
      </span>
      <span className="min-w-0">
        <span className="block whitespace-normal break-words text-[15px] font-medium leading-snug text-fg0 sm:truncate">
          {person.name}
        </span>
        {person.offer && (
          <span className="block whitespace-normal break-words text-[13px] text-fg3 sm:truncate">{person.offer}</span>
        )}
        {person.leftOff && (
          <span className="mt-0.5 block whitespace-normal text-[14px] leading-snug text-fg0">{person.leftOff}</span>
        )}
      </span>
    </span>
  );
}

function PayCell({ person }: { person: CrmBoardPerson }) {
  if (!person.pago) return null;
  return (
    <span className="min-w-0">
      <span className={`block text-sm ${person.pago === "Sin pago" ? "text-fg3" : "text-fg0"}`}>{person.pago}</span>
      {person.pagoNote && <span className="block text-[12.5px] text-fg3">{person.pagoNote}</span>}
    </span>
  );
}

export function CrmBoardView({
  board,
  query,
  onQuery,
  bucket,
  onBucket,
  offer,
  offers,
  onOffer,
  period,
  onPeriod,
  onAsk,
  showColumns,
  onToggleColumns,
}: {
  board: CrmBoard;
  query: string;
  onQuery: (value: string) => void;
  bucket: CrmBoardBucket;
  onBucket: (value: CrmBoardBucket) => void;
  offer: string;
  offers: { id: string; productName: string }[];
  onOffer: (value: string) => void;
  period: CrmBoardPeriod;
  onPeriod: (value: CrmBoardPeriod) => void;
  onAsk: (person: CrmBoardPerson) => void;
  showColumns: boolean;
  onToggleColumns: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [bucket, query]);
  const hoyOverflow = hoyMoreCount(board.hoy.length);
  const hoyShown = expanded ? board.hoy : board.hoy.slice(0, CRM_HOY_CAP);
  const hoyHidden = expanded ? 0 : hoyOverflow;
  // «Ver más (N)» is the rest of hoy. Más adelante is not added into that number.
  const showLater =
    bucket !== "seguimiento" || Boolean(query.trim())
      ? true
      : (expanded || hoyOverflow === 0) && board.rows.length > 0;
  const laterAll = showLater ? board.rows : [];
  const laterCap = bucket === "seguimiento" || expanded ? laterAll.length : LIST_CAP;
  const laterShown = laterAll.slice(0, laterCap);
  const laterHidden = laterAll.length - laterShown.length;
  const more = bucket === "seguimiento" && !query.trim() ? hoyHidden : hoyHidden + laterHidden;
  const countLabel = (value: number | null) => (value == null ? "sin datos" : String(value));
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-separator1 bg-bg1 px-3 py-3 sm:px-4" aria-labelledby="crm-hoy">
        <h2 id="crm-hoy" className="font-display text-[22px] font-semibold leading-tight text-fg0">
          A quién contactar hoy
        </h2>
        <p className="mt-1 text-[13px] text-fg3">{board.hoyNote}</p>
        {hoyShown.length > 0 && (
          <ul className="mt-3 divide-y divide-separator1">
            {hoyShown.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => onAsk(person)}
                  className="flex min-h-11 w-full flex-col items-stretch gap-1.5 py-2.5 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                  aria-label={`Preguntar en qué quedaste con ${person.name}`}
                >
                  <PersonCell person={person} />
                  {person.chip && (
                    <span className="sm:shrink-0">
                      <WhenChip tone={person.chip.tone} label={person.chip.label} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-separator1 pt-2">
            {(more > 0 || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="min-h-11 text-sm font-medium text-fg0 underline-offset-2 hover:underline"
              >
                {expanded ? "Ver menos" : `Ver más (${more})`}
              </button>
            )}
            <button
              type="button"
              onClick={onToggleColumns}
              className="min-h-11 text-sm font-medium text-fg0 underline-offset-2 hover:underline"
            >
              {showColumns ? "Ocultar columnas" : "Ver todas las columnas"}
            </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 rounded-full bg-bg2/70 p-1">
          {CRM_BOARD_BUCKETS.map((id) => {
            const active = bucket === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => onBucket(id)}
                className={`${PILL} ${active ? "bg-fg0 text-[#FBF8F2]" : "text-fg0 hover:bg-bg1"}`}
              >
                {BUCKET_LABEL[id]}
                <span
                  className={`rounded-full px-1.5 text-[12px] ${active ? "bg-white/15" : "text-fg3"}`}
                >
                  {countLabel(board.counts[id])}
                </span>
              </button>
            );
          })}
        </div>
        <label className="sr-only" htmlFor="crm-oferta">
          Oferta
        </label>
        <select id="crm-oferta" className={SELECT} value={offer} onChange={(event) => onOffer(event.target.value)}>
          <option value="todas">Todas las ofertas</option>
          {offers.map((row) => (
            <option key={row.id} value={row.productName}>
              {row.productName}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="crm-periodo">
          Período
        </label>
        <select
          id="crm-periodo"
          className={SELECT}
          value={period}
          onChange={(event) => onPeriod(event.target.value as CrmBoardPeriod)}
        >
          <option value="mes">Este mes</option>
          <option value="anterior">Mes anterior</option>
          <option value="todo">Todos</option>
        </select>
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Buscar por nombre</span>
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Buscar por nombre"
            className="h-11 min-h-11 w-full rounded-full border border-separator2 bg-bg1 pl-9 pr-3 text-sm text-fg0 outline-none"
          />
        </label>
      </div>

      {showLater && (
      <div className="overflow-hidden rounded-2xl border border-separator1 bg-bg1">
        {board.restTitle && (
          <p className="border-b border-separator1 px-4 py-2.5 text-sm text-fg2">{board.restTitle}</p>
        )}
        <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 border-b border-separator1 px-4 py-2 text-[11px] font-semibold tracking-wide text-fg3 sm:grid">
          <span>Persona</span>
          <span>Pago</span>
          <span>Seguimiento</span>
        </div>
        {laterShown.length === 0 ? (
          <p className="px-4 py-8 text-sm text-fg3">{board.empty}</p>
        ) : (
          <ul className="divide-y divide-separator1">
            {laterShown.map((person) => (
              <li key={`${person.bucket}-${person.id}`}>
                <button
                  type="button"
                  onClick={() => onAsk(person)}
                  className="grid w-full grid-cols-1 items-center gap-2 px-3 py-3 text-left hover:bg-bg0 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:gap-3 sm:px-4"
                  aria-label={`Preguntar en qué quedaste con ${person.name}`}
                >
                  <PersonCell person={person} />
                  <PayCell person={person} />
                  <span className="sm:justify-self-end">
                    {person.chip && <WhenChip tone={person.chip.tone} label={person.chip.label} />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {board.footer && (
          <div className="border-t border-separator1 px-4 py-3 text-[13px] text-fg3">
            <p>{board.footer}</p>
          </div>
        )}
      </div>
      )}
      <p className="text-[13px] text-fg3">
        Toca un nombre y se lo preguntas al chat. ¿Algo más fino? Pídeselo: «los que no cerraron en septiembre».
      </p>
    </div>
  );
}
