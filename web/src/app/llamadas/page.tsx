"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { CallsSkeleton } from "@/components/page-skeleton";
import { FathomSyncPanel } from "@/components/fathom-sync-panel";
import { CalendarConnectPanel } from "@/components/calendar-connect-panel";
import { Button } from "@/components/ui/button";
import { PersonFicha, PersonNameButton } from "@/components/person-ficha";
import { fichaFromCall, type FichaTarget } from "@/lib/ficha-target";
import { isNonSalesCall } from "@/lib/call-kind";
import { quickFollowupIso } from "@/lib/followup-date";
import { internasSinCliente, joinDistinct } from "@/lib/crm-noise";
import { formatBogotaDay } from "@/lib/crm-time";
import { pendingHeading, pendingPromptActions, sliceCallHistory, type HistoryScope } from "@/lib/llamadas-density";
import { plainStatus, porConfirmarLabel } from "@/lib/plain-labels";

type CallRow = {
  id: string;
  callRecordId?: string;
  source: string;
  title: string;
  interna?: boolean;
  inCrm?: boolean;
  date: string | null;
  callType: string;
  result: string;
  leadName: string;
  offerName: string;
  trainsBot: boolean;
  analyzed: boolean;
  href: string;
};

type Review = {
  id: string;
  title: string;
  leadName?: string;
  question: string;
  field: string;
  showToggle: boolean;
  options?: string[];
  date?: string | null;
};

function shownDate(value?: string | null) {
  if (!value) return "Sin fecha";
  return formatBogotaDay(value) || "Sin fecha";
}

function practiceHref(row: CallRow) {
  return row.result === "cerro" || isNonSalesCall(row.callType)
    ? `/practicar?mode=compose&focus=${encodeURIComponent(row.leadName || row.title)}`
    : `/practicar?mode=replay&call=${encodeURIComponent(`${row.source}:${row.id}`)}`;
}

function PendingCard({
  item,
  disabled,
  onSend,
}: {
  item: Review;
  disabled: boolean;
  onSend: (body: Record<string, string>) => void;
}) {
  const [otherDate, setOtherDate] = useState("");
  const [answer, setAnswer] = useState("");
  const prompt = pendingPromptActions(item);
  const chipClass =
    "inline-flex h-11 min-h-11 items-center rounded-full border border-separator2 bg-bg0 px-3.5 text-sm font-medium text-fg0 disabled:opacity-60";
  return (
    <div className="space-y-3 rounded-2xl border border-separator1 bg-bg1 p-4">
      <div>
        <p className="text-[15px] font-semibold text-fg0">{pendingHeading(item)}</p>
        <p className="text-[13px] text-fg3">{shownDate(item.date)}</p>
      </div>
      {item.question && <p className="text-sm text-fg1">{item.question}</p>}
      {prompt.chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {prompt.chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={disabled}
              onClick={() => onSend({ action: "answer", field: chip.field, value: chip.value })}
              className={chipClass}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
      {prompt.sale && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="min-h-11"
            variant="primary"
            disabled={disabled}
            onClick={() => onSend({ action: "commercial" })}
          >
            Sí, es una venta
          </Button>
          <Button
            size="sm"
            className="min-h-11"
            variant="outline"
            disabled={disabled}
            onClick={() => onSend({ action: "non_commercial" })}
          >
            No es una venta
          </Button>
        </div>
      )}
      {prompt.when && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["hoy", "Hoy"],
              ["manana", "Mañana"],
              ["semana", "Esta semana"],
            ] as const
          ).map(([choice, label], index) => (
            <Button
              key={choice}
              size="sm"
              className="min-h-11"
              variant={index === 0 ? "primary" : "outline"}
              disabled={disabled}
              onClick={() =>
                onSend({
                  action: "answer",
                  field: "proximo_seguimiento",
                  value: quickFollowupIso(choice),
                })
              }
            >
              {label}
            </Button>
          ))}
          <input
            type="date"
            lang="es-CO"
            value={otherDate}
            onChange={(event) => setOtherDate(event.target.value)}
            className="h-11 min-h-[44px] min-w-11 rounded-md border border-separator1 bg-bg0 px-2 text-xs lg:h-8 lg:min-h-0 lg:min-w-0"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !otherDate}
            onClick={() =>
              onSend({
                action: "answer",
                field: "proximo_seguimiento",
                value: otherDate,
              })
            }
          >
            Otra fecha
          </Button>
        </div>
      )}
      {prompt.freeText && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!answer.trim()) return;
            onSend({
              action: "answer",
              field: item.field || "revision",
              value: answer.trim(),
            });
          }}
        >
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="h-11 min-h-[44px] min-w-11 flex-1 rounded-md border border-separator1 bg-bg0 px-2 text-sm lg:h-8 lg:min-h-0 lg:min-w-0"
            placeholder={item.field === "cliente_real" ? "El nombre" : "La respuesta"}
          />
          <button
            type="submit"
            disabled={disabled || !answer.trim()}
            className="inline-flex h-11 min-h-11 shrink-0 items-center justify-center rounded-[10px] bg-fg0 px-3.5 text-sm font-semibold text-[#FBF8F2] disabled:bg-[#E8E0D4] disabled:text-fg0 disabled:opacity-100"
          >
            {disabled ? "Guardando…" : "Guardar"}
          </button>
        </form>
      )}
    </div>
  );
}

function HistoryRow({
  row,
  auditing,
  onAudit,
  onOpen,
}: {
  row: CallRow;
  auditing: boolean;
  onAudit: (row: CallRow) => void;
  onOpen: (row: CallRow) => void;
}) {
  const heading = pendingHeading(row);
  const person = !row.interna && !/^(sin nombre|llamada)\b/i.test(heading) && !/^\d/.test(heading);
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-separator1 bg-bg1 px-3 py-3">
      <div className="min-w-0">
        {person ? (
          <PersonNameButton name={heading} onOpen={() => onOpen({ ...row, leadName: heading })} className="text-sm" />
        ) : (
          <p className="whitespace-normal break-words text-sm" title={row.title}>
            {heading}
          </p>
        )}
        <p className="text-xs text-fg3">
          {joinDistinct([
            shownDate(row.date),
            row.offerName,
            row.callType ? plainStatus(row.callType) : "",
            row.result ? plainStatus(row.result) : "",
          ]) || row.source}
        </p>
        {auditing && (
          <p className="text-xs text-fg3">Analizando la llamada… puede tardar unos segundos</p>
        )}
      </div>
      <div className="flex shrink-0">
        {row.analyzed ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={row.href}>Coach</Link>
          </Button>
        ) : row.source === "upload" ? (
          <Button size="sm" variant="ghost" disabled={auditing} onClick={() => onAudit(row)}>
            {auditing ? "Analizando…" : "Revisar"}
          </Button>
        ) : (
          <Button asChild size="sm" variant="ghost">
            <Link href={practiceHref(row)}>Practicar</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function LlamadasPage() {
  const { status } = useSession();
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [queue, setQueue] = useState<Review[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scope, setScope] = useState<HistoryScope>("semana");
  const hasQueue = queue.length > 0;
  // Inicio's «Confirmar →» links here. The list loads after the page, so scroll once it shows.
  useEffect(() => {
    if (!hasQueue || window.location.hash !== "#por-clasificar") return;
    document.getElementById("por-clasificar")?.scrollIntoView({ block: "start" });
  }, [hasQueue]);
  const [reviewing, setReviewing] = useState(false);
  const [auditingId, setAuditingId] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [showInternas, setShowInternas] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [ficha, setFicha] = useState<FichaTarget | null>(null);
  const decidedSetup = useRef(false);

  const loadCalls = () =>
    fetch("/api/llamadas")
      .then((r) => r.json())
      .then((data) => {
        setCalls(Array.isArray(data?.calls) ? data.calls : []);
        const nextQueue = Array.isArray(data?.queue)
          ? data.queue
          : data?.review
            ? [data.review]
            : [];
        setQueue(nextQueue);
        if (!decidedSetup.current) {
          decidedSetup.current = true;
          setShowSetup(nextQueue.length === 0);
        } else if (nextQueue.length === 0) {
          setShowSetup(true);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));

  useEffect(() => {
    if (status !== "authenticated") return;
    void loadCalls();
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (calls.length === 0) return;
    if (calls.every((row) => row.callType)) return;
    let cancelled = false;
    const classifyNext = async () => {
      const response = await fetch("/api/llamadas", { method: "POST" });
      const data = await response.json();
      if (cancelled || data.done) return;
      await loadCalls();
    };
    void classifyNext().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, calls]);

  const sendReview = async (item: Review, body: Record<string, string>) => {
    setReviewing(true);
    setAuditError(null);
    try {
      const response = await fetch("/api/llamadas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callRecordId: item.id, ...body }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar");
      const nextQueue = Array.isArray(data?.queue)
        ? data.queue
        : data?.review
          ? [data.review]
          : [];
      setQueue(nextQueue);
      await loadCalls();
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setReviewing(false);
    }
  };

  const auditRow = async (row: CallRow) => {
    setAuditingId(row.id);
    setAuditError(null);
    try {
      const response = await fetch("/api/qc-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: row.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo revisar");
      await loadCalls();
      if (data.sessionId) window.location.href = `/coach/${data.sessionId}`;
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : "No se pudo revisar");
    } finally {
      setAuditingId(null);
    }
  };

  const internas = internasSinCliente(calls);
  const primary = calls.filter((row) => !internas.includes(row));
  const weekSlice = sliceCallHistory(primary, scope);
  const weekVisible = weekSlice.visible;
  const internaVisible = sliceCallHistory(internas, scope).visible;

  return (
    <AppShell wide>
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold leading-tight tracking-[-0.01em] text-fg0 md:text-[40px]">
            Mis llamadas
          </h1>
          <p className="mt-1 text-sm text-fg3">
            Grabaciones y archivos. De aquí salen la práctica, el coach y el CRM.
          </p>
        </div>

        {status !== "authenticated" ? (
          <Button asChild variant="primary">
            <Link href="/login?callbackUrl=/llamadas">Entrar</Link>
          </Button>
        ) : !loaded ? (
          <CallsSkeleton />
        ) : (
          <>
            {queue.length > 0 && (
              <section id="por-clasificar" className="scroll-mt-4 space-y-3">
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-[14px] border border-[#EBD3A8] bg-[#F6E7CC] py-2 pl-3 pr-2 md:gap-3 md:py-3 md:pl-[18px] md:pr-3.5">
                  <p className="min-w-0 text-[13px] font-medium text-[#5E3B0B] md:text-[15px]">
                    {porConfirmarLabel(queue.length)}
                  </p>
                </div>
                {queue.map((item) => (
                  <PendingCard
                    key={item.id}
                    item={item}
                    disabled={reviewing}
                    onSend={(body) => void sendReview(item, body)}
                  />
                ))}
              </section>
            )}
            {showSetup ? (
              <>
                <FathomSyncPanel authenticated />
                <CalendarConnectPanel authenticated />
                <Button asChild variant="outline" size="sm">
                  <Link href="/ofertas">Subir archivos o pegar una transcripción</Link>
                </Button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowSetup(true)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl border border-separator1 bg-bg1 px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-medium text-fg0">Grabaciones</span>
                  <span className="block text-[13px] text-fg3">Conectar o traer el historial</span>
                </span>
                <span className="text-sm font-medium text-fg2">Abrir</span>
              </button>
            )}
            {auditError && (
              <p className="text-sm text-destructive">{auditError}</p>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="llamadas-periodo">
                  Período
                </label>
                <select
                  id="llamadas-periodo"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as HistoryScope)}
                  className="h-11 min-h-11 rounded-full border border-separator2 bg-bg1 px-3 text-sm text-fg0"
                >
                  <option value="semana">Esta semana</option>
                  <option value="mes">Este mes</option>
                  <option value="todas">Todas</option>
                </select>
                {scope !== "todas" && primary.length > weekVisible.length && (
                  <button
                    type="button"
                    onClick={() => setScope("todas")}
                    className="min-h-11 text-sm font-medium text-fg0 underline-offset-2 hover:underline"
                  >
                    Ver todas ({primary.length})
                  </button>
                )}
              </div>
              {weekSlice.fallback && (
                <p className="text-[13px] text-fg3">Esta semana no hay llamadas. Estas son las más recientes.</p>
              )}
              {weekVisible.map((row) => (
                <HistoryRow
                  key={`${row.source}-${row.id}`}
                  row={row}
                  auditing={auditingId === row.id}
                  onAudit={(item) => void auditRow(item)}
                  onOpen={(item) => setFicha(fichaFromCall(item))}
                />
              ))}
              {internas.length > 0 && (
                <Button
                  size="sm"
                  className="min-h-11"
                  variant={showInternas ? "primary" : "outline"}
                  onClick={() => setShowInternas((value) => !value)}
                >
                  {showInternas
                    ? "Ocultar llamadas internas o sin cliente"
                    : `Mostrar llamadas internas o sin cliente (${internas.length})`}
                </Button>
              )}
              {showInternas &&
                internaVisible.map((row) => (
                  <HistoryRow
                    key={`${row.source}-${row.id}`}
                    row={row}
                    auditing={auditingId === row.id}
                    onAudit={(item) => void auditRow(item)}
                    onOpen={(item) => setFicha(fichaFromCall(item))}
                  />
                ))}
              {calls.length === 0 && (
                <p className="text-sm text-fg3">Aún no hay llamadas. Conecta las grabaciones o súbelas.</p>
              )}
              {primary.length === 0 && internas.length > 0 && !showInternas && (
                <p className="text-sm text-fg3">
                  Solo hay llamadas internas o sin cliente. Ábrelas con el botón de arriba.
                </p>
              )}
            </div>
          </>
        )}
      </div>
      <PersonFicha target={ficha} onClose={() => setFicha(null)} />
    </AppShell>
  );
}
