"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { CrmSkeleton } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";
import { BarChart } from "@/components/bar-chart";
import { HelpNote, MetricCard, SectionHeading } from "@/components/metric-card";
import { ProjectionCard } from "@/components/projection-card";
import { CrmAsk } from "@/components/crm-ask";
import { SheetTable, sheetCell, type SheetColumn } from "@/components/crm-sheet";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OperacionRow } from "@/lib/crm-operacion";
import { moneyLabel, pctLabel } from "@/lib/crm-operacion";
import {
  EMPTY_CRM_FILTER,
  matchesCrmListFilter,
  monthKey,
  monthLabel,
  uniqueSorted,
  weekKey,
  weekLabel,
  type CrmListFilter,
} from "@/lib/crm-filters";
import type { CommissionProjection } from "@/lib/crm-projection";
import { plainStatus } from "@/lib/plain-labels";
import { ACTIVA_EXPLAIN, filaCountLabel, latestActiveRows, operacionCountLine } from "@/lib/crm-activa";
import { clienteVisible } from "@/lib/crm-noise";
import { derivedPaso, operacionGlance } from "@/lib/crm-glance";
import {
  AHORA_TAB_NOTE,
  COBRADO_PERIOD_NOTE,
  PERIODO_TAB_NOTE,
  SEGUIMIENTOS_SALDO_NOTE,
  cobradoPeriodLine,
  seguimientosHeader,
} from "@/lib/crm-period-copy";
import { dineroEnJuegoNote, saldoPorCobrarNote, type PipelineLine } from "@/lib/crm-pipeline";
import { followupCardStatus } from "@/lib/home-desk";
import { PipelineDetail } from "@/components/pipeline-detail";
import { foldLeadName, followupSnapshot, isMeetingFollowup, shownFollowupKind } from "@/lib/crm-followups";
import { LOST_REASONS, lostScopeMessage, openFollowupCount } from "@/lib/followup-desk";
import { zonedDayKey } from "@/lib/crm-time";
import {
  addCalendarDays,
  deskUndoMessage,
  projectDeskRows,
  projectOperacionProximo,
  type DeskResultado,
} from "@/lib/followup-desk";

type ModuleId =
  | "ahora"
  | "periodo"
  | "operacion"
  | "dashboard"
  | "seguimientos"
  | "comisiones";

type Period = {
  agendas: number;
  shows: number;
  noShows: number;
  reprogramadas: number;
  cierres: number;
  showRate: number;
  closeRate: number;
  closeRateCalificado: number;
  ticket: number;
  ventas: number;
  cash: number;
  cashPct: number;
};

type Followup = {
  id: string;
  leadId?: string;
  question: string;
  dueAt: string;
  tipo: string;
  hilo?: string;
  paso?: string;
  intentos?: number;
  ultimoToque?: string;
  proximaAccion?: string;
  askLost?: boolean;
  cliente: string;
  estado: string;
  days: number;
  mensajeSugerido?: string;
  enJuego?: number;
  canal?: string;
  telefono?: string;
  oferta?: string;
  contexto?: string;
  acuerdo?: string;
  temperatura?: "alto" | "medio" | "bajo";
  queHacer?: string;
  opciones?: FollowupOptionView[];
  selectedId?: string;
  callId?: string;
  proximo?: string;
  closesOnHecho?: boolean;
  nextOnHecho?: string;
  suggestedNext?: string;
};

type Commission = {
  id: string;
  fecha: string;
  oferta: string;
  cliente?: string;
  venta: number;
  cash: number;
  pct: number;
  generada: number;
  cobrada: number;
  estado: string;
  fechaCobro: string | null;
};

type Dash = {
  today?: string;
  readyCrm?: boolean;
  missingCrm?: { question: string } | null;
  now?: Record<string, number>;
  pipelineDetalle?: PipelineLine[];
  rendimiento?: { mes: Period; anterior: Period; acumulado: Period };
  ventasDetalle?: {
    n: number;
    total: number;
    leads: { id: string; cliente: string; fecha: string; venta: number; oferta: string }[];
    sinMonto?: { id: string; cliente: string; fecha: string; venta: number; oferta: string }[];
  };
  followups?: Followup[];
  commissions?: Commission[];
  comisionResumen?: {
    generada: number;
    cobrada: number;
    pendiente: number;
    pctCobrado: number;
  };
  desglose?: {
    porOferta: { oferta: string; cierres: number; ventas: number; cash: number }[];
    embudo: { agendas: number; shows: number; cierres: number };
    razonNoCierre: { razon: string; count: number }[];
    etapaPerdida?: { etapa: string; count: number }[];
  };
  evolucion?: {
    mes: string;
    agendas: number;
    shows: number;
    cierres: number;
    ventas: number;
    cash: number;
  }[];
  offers?: { id: string; productName: string; currency: string }[];
  operacion?: OperacionRow[];
  monthlyGoalUsd?: number | null;
  needsMonthlyGoal?: boolean;
  projection?: CommissionProjection | null;
};

const MODULES: { id: ModuleId; label: string }[] = [
  { id: "ahora", label: "Ahora mismo" },
  { id: "periodo", label: "Período" },
  { id: "operacion", label: "Operación" },
  { id: "dashboard", label: "Resumen" },
  { id: "seguimientos", label: "Seguimientos" },
  { id: "comisiones", label: "Comisiones" },
];

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

function matchesOffer(value: string, selected: string) {
  if (selected === "todas") return true;
  const a = (value || "").toLowerCase();
  const b = selected.toLowerCase();
  return Boolean(a) && (a === b || a.includes(b) || b.includes(a));
}

export default function CrmPage() {
  const { status } = useSession();
  const [data, setData] = useState<Dash | null>(null);
  const [offer, setOffer] = useState("todas");
  const [listFilter, setListFilter] = useState<CrmListFilter>(EMPTY_CRM_FILTER);
  const [module, setModule] = useState<ModuleId>("operacion");
  const [openAlert, setOpenAlert] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; message: string; snapshot: Dash } | null>(null);
  const [showInternas, setShowInternas] = useState(false);
  const [onlyActivas, setOnlyActivas] = useState(false);
  const saving = useRef(false);

  const load = () =>
    fetch("/api/crm")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload?.now) {
          setLoadError(payload?.error || payload?.warning || "No se pudo cargar el CRM");
          return;
        }
        setLoadError(payload.warning || null);
        setData(payload);
      })
      .catch(() => setLoadError("No se pudo cargar el CRM"));

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as ModuleId;
    if (MODULES.some((item) => item.id === hash)) setModule(hash);
    if (new URLSearchParams(window.location.search).get("activas") === "1") {
      setOnlyActivas(true);
      setModule("operacion");
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((ws) => {
        if (ws.showCrm === false) {
          window.location.replace("/");
          return;
        }
        void load();
      })
      .catch(() => void load());
  }, [status]);

  const refresh = async () => {
    const response = await fetch("/api/crm");
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.now) return false;
    setLoadError(null);
    setData(payload);
    return true;
  };

  const patch = async (
    alertId: string,
    resultado: string,
    agenda?: boolean,
    nextAt?: string,
    reason?: { id: string; note: string },
  ) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(resultado);
    setActionError(null);
    const previous = data;
    const today = data?.today || zonedDayKey(new Date());
    if (data && !agenda) {
      const followups = asList<NonNullable<Dash["followups"]>[number]>(data.followups);
      const target = followups.find((row) => row.id === alertId);
      const clickedCallId = alertId.startsWith("call:")
        ? alertId.slice("call:".length)
        : target?.callId || "";
      const clickedCall = asList<NonNullable<Dash["operacion"]>[number]>(data.operacion).find((row) => row.id === clickedCallId) || null;
      const leadId = target?.leadId || clickedCall?.leadId || "";
      const lostIds =
        resultado === "perdido" && leadId
          ? followups.filter((row) => row.leadId === leadId).map((row) => row.id)
          : [];
      const projected = projectDeskRows(followups, {
        targetId: alertId,
        action: resultado as DeskResultado,
        today,
        nextAt,
        alsoDropIds: lostIds,
      });
      const cliente = target?.cliente || clickedCall?.cliente || "";
      const lostCalls =
        resultado === "perdido" && leadId
          ? asList<NonNullable<Dash["operacion"]>[number]>(data.operacion)
              .filter(
                (row) => row.leadId === leadId && (row.fechaProximo || row.id === clickedCallId),
              )
              .map((row) => row.id)
          : [];
      const operacion = projectOperacionProximo(asList<NonNullable<Dash["operacion"]>[number]>(data.operacion), {
        callId: clickedCallId || target?.callId,
        callIds: lostCalls,
        leadId,
        cliente,
        proximo: projected.proximo,
        resultado,
        closeAll: resultado === "perdido",
      });
      const counts = followupSnapshot(projected.rows);
      setUndo({
        id: alertId,
        message: deskUndoMessage({
          action: resultado as DeskResultado,
          nombre: cliente,
          proximo: projected.proximo,
          leaves: projected.leaves,
          closedCount:
            resultado === "perdido"
              ? openFollowupCount(asList<NonNullable<Dash["operacion"]>[number]>(data.operacion), leadId, clickedCallId)
              : 1,
        }),
        snapshot: data,
      });
      setData({
        ...data,
        followups: projected.rows,
        operacion,
        now: {
          ...(data.now || {}),
          seguimientosHoy: counts.seguimientosHoy,
          seguimientosVencidos: counts.seguimientosVencidos,
          dineroEnJuego: data.now?.dineroEnJuego || 0,
        },
      });
      if (projected.leaves) {
        setOpenAlert((current) => (current === alertId ? null : current));
      }
    }
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          agenda
            ? { alertId, action: "agenda", agendaEstado: resultado }
            : {
                alertId,
                action: "outcome",
                resultado,
                nextAt,
                nota: reason?.note || "",
                razonNoCierre: reason?.id || "",
              },
        ),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error || "No se guardó. Inténtalo otra vez.");
      }
      await refresh();
    } catch (error) {
      if (previous) setData(previous);
      setUndo(null);
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : "No se guardó. Inténtalo otra vez.",
      );
    } finally {
      saving.current = false;
      setBusy(null);
    }
  };

  const reopen = async (alertId?: string) => {
    const id = alertId || undo?.id;
    if (!id || saving.current) return;
    const pending = undo;
    const closed = data;
    saving.current = true;
    setBusy("reabrir");
    setActionError(null);
    if (pending && (!alertId || alertId === pending.id)) setData(pending.snapshot);
    setUndo(null);
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: id, action: "reabrir" }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error || "No se pudo deshacer.");
      }
      await refresh();
    } catch (error) {
      if (closed) setData(closed);
      if (pending) setUndo(pending);
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : "No se pudo deshacer.",
      );
    } finally {
      saving.current = false;
      setBusy(null);
    }
  };

  const pickScript = async (alertId: string, optionId: string) => {
    await fetch("/api/crm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId, action: "pick-script", optionId }),
    });
    await load();
  };

  const markCommission = async (commissionId: string) => {
    await fetch("/api/crm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "commission-paid", commissionId }),
    });
    await load();
  };

  const saveName = async (args: { callId?: string; leadId?: string; name: string }) => {
    setBusy("nombre");
    setActionError(null);
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename-lead", ...args }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No pude guardar el nombre.");
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No pude guardar el nombre.");
    } finally {
      setBusy(null);
    }
  };

  const saveCash = async (callId: string, amount: number) => {
    setBusy("cash");
    setActionError(null);
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-cash", callId, amount }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No pude guardar el cobrado.");
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No pude guardar el cobrado.");
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (row: OperacionRow) => {
    setBusy("eliminar");
    setActionError(null);
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-row", callId: row.id }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo eliminar la fila.");
      if (openCall === row.id) setOpenCall(null);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo eliminar la fila.");
    } finally {
      setBusy(null);
    }
  };

  const saveGoal = async (usd: number) => {
    setSavingGoal(true);
    try {
      await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "monthly-goal", amount: usd }),
      });
      await load();
    } finally {
      setSavingGoal(false);
    }
  };

  const offers = asList<NonNullable<Dash["offers"]>[number]>(data?.offers);
  const currency =
    offers.find((row) => row.productName === offer)?.currency ||
    offers[0]?.currency ||
    "USD";
  const money = (value: number | null | undefined) => moneyLabel(value, currency);

  const operacionBase = useMemo(
    () => asList<NonNullable<Dash["operacion"]>[number]>(data?.operacion).filter((row) => matchesOffer(row.oferta || row.producto, offer)),
    [data?.operacion, offer],
  );
  const internasCount = operacionBase.filter((row) => row.interna).length;
  const operacionVisible = useMemo(() => {
    return showInternas ? operacionBase : operacionBase.filter((row) => !row.interna);
  }, [operacionBase, showInternas]);
  const activeOperacion = useMemo(() => latestActiveRows(operacionVisible), [operacionVisible]);
  const operacionScoped = onlyActivas ? activeOperacion : operacionVisible;
  const followupsBase = useMemo(
    () => asList<NonNullable<Dash["followups"]>[number]>(data?.followups).filter((row) => matchesOffer(row.oferta || "", offer)),
    [data?.followups, offer],
  );
  const commissionsBase = useMemo(
    () => asList<NonNullable<Dash["commissions"]>[number]>(data?.commissions).filter((row) => matchesOffer(row.oferta || "", offer)),
    [data?.commissions, offer],
  );
  const listRows = useMemo(() => {
    if (module === "seguimientos") {
      return followupsBase.map((row) => ({
        name: row.cliente,
        date: row.dueAt,
        estado: row.hilo || row.tipo,
      }));
    }
    if (module === "comisiones") {
      return commissionsBase.map((row) => ({
        name: row.cliente || "",
        date: row.fecha,
        estado: row.estado,
      }));
    }
    return operacionScoped.map((row) => ({
      name: clienteVisible(row.cliente, row.titulo),
      date: row.fecha,
      estado: row.estadoAgenda,
    }));
  }, [module, operacionScoped, followupsBase, commissionsBase]);
  const operacion = useMemo(
    () =>
      operacionScoped.filter((row) =>
        matchesCrmListFilter(
          {
            name: clienteVisible(row.cliente, row.titulo),
            date: row.fecha,
            estado: row.estadoAgenda,
          },
          listFilter,
        ),
      ),
    [operacionScoped, listFilter],
  );
  const followups = useMemo(
    () =>
      followupsBase.filter((row) =>
        matchesCrmListFilter(
          { name: row.cliente, date: row.dueAt, estado: row.hilo || row.tipo },
          listFilter,
        ),
      ),
    [followupsBase, listFilter],
  );
  const commissions = useMemo(
    () =>
      commissionsBase.filter((row) =>
        matchesCrmListFilter(
          { name: row.cliente || "", date: row.fecha, estado: row.estado },
          listFilter,
        ),
      ),
    [commissionsBase, listFilter],
  );
  const showListFilters = module === "operacion" || module === "seguimientos" || module === "comisiones";

  const now = data?.now || {};
  const rendimiento = data?.rendimiento;
  const selectedCall = operacion.find((row) => row.id === openCall) || null;
  const selectedFollowup = followups.find((row) => row.id === openAlert) || null;

  return (
    <AppShell wide>
      <div className="space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-fg3">Centro de control comercial</p>
          <h1 className="text-2xl font-light">CRM</h1>
        </div>
        {status !== "authenticated" ? (
          <Button asChild variant="primary">
            <Link href="/login?callbackUrl=/crm">Entrar</Link>
          </Button>
        ) : loadError && !data ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : !data ? (
          <CrmSkeleton />
        ) : (
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-4">
          <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
            {!data.readyCrm && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                <p className="text-sm">
                  {data.missingCrm?.question ||
                    "Falta el bloque comercial de la oferta para calcular ventas y comisión con precisión."}
                </p>
                <Button asChild variant="primary" size="sm">
                  <Link href="/ofertas">Completar en Ofertas</Link>
                </Button>
              </div>
            )}

            {offers.length > 1 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={offer === "todas" ? "primary" : "outline"}
                  onClick={() => setOffer("todas")}
                >
                  Todas
                </Button>
                {offers.map((row) => (
                  <Button
                    key={row.id}
                    size="sm"
                    variant={offer === row.productName ? "primary" : "outline"}
                    className="h-auto max-w-full whitespace-normal text-left"
                    onClick={() => setOffer(row.productName)}
                  >
                    {row.productName}
                  </Button>
                ))}
              </div>
            )}

            <AhoraGlance
              now={now}
              money={money}
              onOpen={(target) => {
                if (target === "activas") {
                  setOnlyActivas(true);
                  setModule("operacion");
                  window.history.replaceState(null, "", "?activas=1#operacion");
                  return;
                }
                setModule("seguimientos");
                window.history.replaceState(null, "", "#seguimientos");
              }}
            />

            <div className="flex flex-wrap gap-2 border-b border-separator1 pb-2">
              {MODULES.map((item) => (
                <Button
                  key={item.id}
                  size="xl"
                  variant={module === item.id ? "primary" : "outline"}
                  onClick={() => {
                    setModule(item.id);
                    window.history.replaceState(null, "", `#${item.id}`);
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>

            {loadError && (
              <p className="text-sm text-destructive" role="alert">
                {loadError}
              </p>
            )}
            {undo && (
              <div className="flex flex-col gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm" role="status">
                  {undo.message}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void reopen()}
                >
                  {busy === "reabrir" ? "Deshaciendo…" : "Deshacer"}
                </Button>
              </div>
            )}
            {actionError && (
              <p className="text-sm text-destructive" role="alert">
                {actionError}
              </p>
            )}

            {showListFilters && (
              <CrmListFilters
                rows={listRows}
                filter={listFilter}
                shown={
                  module === "seguimientos"
                    ? followups.length
                    : module === "comisiones"
                      ? commissions.length
                      : operacion.length
                }
                onChange={setListFilter}
              />
            )}
            {module === "operacion" && (
              <div className="space-y-2">
                <p className="text-xs text-fg3">
                  {operacionCountLine({
                    shown: operacion.length,
                    inScope: operacionScoped.length,
                    onlyActivas,
                    activeRows: activeOperacion.length,
                    oportunidades: now.oportunidadesActivas || 0,
                  })}
                </p>
                <p className="text-xs text-fg3">{ACTIVA_EXPLAIN}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="min-h-11"
                    variant={onlyActivas ? "primary" : "outline"}
                    onClick={() => setOnlyActivas((value) => !value)}
                  >
                    {onlyActivas ? "Ver todas las filas" : "Solo activas"}
                  </Button>
                  {internasCount > 0 && (
                    <Button
                      size="sm"
                      className="min-h-11"
                      variant={showInternas ? "primary" : "outline"}
                      onClick={() => setShowInternas((value) => !value)}
                    >
                      {showInternas
                        ? "Ocultar llamadas internas"
                        : `Mostrar llamadas internas (${internasCount})`}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {module === "ahora" && (
              <AhoraSheet
                now={now}
                money={money}
                projection={data.projection || null}
                needsGoal={data.needsMonthlyGoal}
                saving={savingGoal}
                onSaveGoal={saveGoal}
                currency={currency}
                rendimiento={rendimiento}
                offerNote={
                  offer !== "todas"
                    ? `Las tasas de abajo son de todas las ofertas. Operación, seguimientos y comisiones sí están filtradas a ${offer}.`
                    : null
                }
              />
            )}
            {module === "periodo" && rendimiento && (
              <PeriodoSheet
                rendimiento={rendimiento}
                money={money}
                offerNote={
                  offer !== "todas"
                    ? `Las tasas son de todas las ofertas. Operación, seguimientos y comisiones sí están filtradas a ${offer}.`
                    : null
                }
              />
            )}
            {module === "operacion" && (
              <OperacionSheet
                rows={operacion}
                scopeRows={operacionBase}
                money={money}
                selectedId={openCall}
                onSelect={(id) => setOpenCall(openCall === id ? null : id)}
                selected={selectedCall}
                followups={followupsBase}
                busy={busy}
                today={data.today || zonedDayKey(new Date())}
                onPatch={patch}
                onReopen={reopen}
                onCash={saveCash}
                onRename={saveName}
                onDelete={removeRow}
                empty={
                  operacionScoped.length > 0 && operacion.length === 0
                    ? "Nada con estos filtros."
                    : operacion.length === 0 &&
                        internasCount > 0 &&
                        !showInternas &&
                        operacionBase.every((row) => row.interna)
                      ? "No hay llamadas con cliente. Las internas están ocultas."
                      : operacion.length === 0 && onlyActivas
                        ? "Ninguna fila es una oportunidad activa."
                        : "Aún no hay llamadas en esta oferta."
                }
              />
            )}
            {module === "dashboard" && (
              <DashboardSheet
                data={data}
                money={money}
                onOpenCall={(id) => {
                  setModule("operacion");
                  setOpenCall(id);
                }}
              />
            )}
            {module === "seguimientos" && (
              <SeguimientosSheet
                rows={followups}
                operacion={operacionBase}
                money={money}
                now={now}
                today={data.today || zonedDayKey(new Date())}
                busy={busy}
                selected={selectedFollowup}
                onSelect={(id) => setOpenAlert(openAlert === id ? null : id)}
                onPick={pickScript}
                onPatch={patch}
                onRename={saveName}
                empty={
                  followupsBase.length > 0 && followups.length === 0
                    ? "Nada con estos filtros."
                    : "No hay seguimientos abiertos."
                }
              />
            )}
            {module === "comisiones" && (
              <ComisionesSheet
                rows={commissions}
                resumen={data.comisionResumen}
                money={money}
                onPaid={markCommission}
                empty={
                  commissionsBase.length > 0 && commissions.length === 0
                    ? "Nada con estos filtros."
                    : "Todavía no hay dinero cobrado en llamadas."
                }
              />
            )}
          </div>
          <CrmAsk
            rows={followupsBase}
            money={(value) => money(value)}
            hidden={Boolean(openCall || openAlert)}
          />
          </div>
        )}
      </div>
    </AppShell>
  );
}

function CrmListFilters({
  rows,
  filter,
  shown,
  onChange,
}: {
  rows: { name: string; date: string | null | undefined; estado: string }[];
  filter: CrmListFilter;
  shown: number;
  onChange: (next: CrmListFilter) => void;
}) {
  const months = uniqueSorted(rows.map((row) => monthKey(row.date))).reverse();
  const weeks = uniqueSorted(
    rows
      .filter((row) => !filter.month || monthKey(row.date) === filter.month)
      .map((row) => weekKey(row.date)),
  ).reverse();
  const estados = uniqueSorted(rows.map((row) => row.estado));
  const active = Boolean(filter.q || filter.estado || filter.month || filter.week);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="w-full space-y-1 sm:w-auto">
        <span className="block text-[11px] uppercase tracking-wide text-fg3">Nombre</span>
        <Input
          value={filter.q}
          placeholder="Buscar"
          className="h-11 min-h-11 w-full min-w-0 sm:w-44"
          onChange={(event) => onChange({ ...filter, q: event.target.value })}
        />
      </label>
      <FilterSelect
        label="Estado"
        value={filter.estado}
        allLabel="Todos"
        options={estados.map((value) => ({ value, label: plainStatus(value) }))}
        onChange={(estado) => onChange({ ...filter, estado })}
      />
      <FilterSelect
        label="Mes"
        value={filter.month}
        allLabel="Todos"
        options={months.map((value) => ({ value, label: monthLabel(value) }))}
        onChange={(month) => onChange({ ...filter, month, week: "" })}
      />
      <FilterSelect
        label="Semana"
        value={weeks.includes(filter.week) ? filter.week : ""}
        allLabel="Todas"
        options={weeks.map((value) => ({ value, label: weekLabel(value) }))}
        onChange={(week) => onChange({ ...filter, week })}
      />
      <p className="pb-1.5 text-xs text-fg3">{filaCountLabel(shown, rows.length)}</p>
      {active && (
        <Button size="sm" variant="ghost" className="min-h-11" onClick={() => onChange(EMPTY_CRM_FILTER)}>
          Quitar filtros
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-sm text-fg3">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 min-h-11 rounded border border-separator2 bg-bg1 px-2 text-sm text-fg2"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function QuietFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-fg3">{label}</dt>
      <dd className="text-sm text-fg0">{value}</dd>
    </div>
  );
}

function AhoraSheet({
  now,
  money,
  projection,
  needsGoal,
  saving,
  onSaveGoal,
  currency,
  rendimiento,
  offerNote,
}: {
  now: Record<string, number>;
  money: (value: number | null | undefined) => string;
  projection: CommissionProjection | null;
  needsGoal?: boolean;
  saving: boolean;
  onSaveGoal: (usd: number) => Promise<void>;
  currency: string;
  rendimiento?: { mes: Period; anterior: Period; acumulado: Period };
  offerNote?: string | null;
}) {
  return (
    <div className="space-y-8">
      <ProjectionCard
        projection={projection}
        needsGoal={needsGoal}
        saving={saving}
        onSaveGoal={onSaveGoal}
        currency={currency}
      />
      <div className="space-y-4">
        <SectionHeading>Ahora mismo</SectionHeading>
        <p className="text-xs text-fg3">{AHORA_TAB_NOTE}</p>
        <dl className="divide-y divide-separator1 border-t border-separator1">
          <QuietFact label="Pendientes de hoy" value={String(now.seguimientosHoy || 0)} />
          <QuietFact label="Vencidos" value={String(now.seguimientosVencidos || 0)} />
          <QuietFact label="Agendas de hoy" value={String(now.agendasHoy || 0)} />
          <QuietFact label="Dinero en juego" value={money(now.dineroEnJuego)} />
          <QuietFact label="Saldo por cobrar" value={money(now.saldoPorCobrar || 0)} />
          <QuietFact label="Pendiente de cobro" value={money(now.cashPendiente)} />
          <QuietFact label="Comisión pendiente" value={money(now.comisionPendiente)} />
          <QuietFact label="Oportunidades activas" value={String(now.oportunidadesActivas || 0)} />
          <p className="pt-2 text-xs text-fg3">{ACTIVA_EXPLAIN}</p>
          <QuietFact label="Llamadas agendadas" value={String(now.agendasFuturas || 0)} />
        </dl>
        <HelpNote>
          <p>Pendientes de hoy son los seguimientos que toca hacer hoy. Vencidos son los que ya debían salir.</p>
          <p>{dineroEnJuegoNote(now.pipelineLeads || 0)} Pendiente de cobro es lo ya acordado que aún no entró.</p>
          <p>{saldoPorCobrarNote(now.saldoPorCobrar || 0)}</p>
          <p>Comisión pendiente es tu parte de lo cobrado. Agendas de hoy y llamadas agendadas son citas en el calendario, no los seguimientos abiertos.</p>
        </HelpNote>
      </div>
      {rendimiento && (
        <div className="space-y-4">
          <SectionHeading>Rendimiento</SectionHeading>
          <PeriodoSheet rendimiento={rendimiento} money={money} offerNote={offerNote || null} />
        </div>
      )}
    </div>
  );
}

function PeriodoSheet({
  rendimiento,
  money,
  offerNote,
}: {
  rendimiento: { mes: Period; anterior: Period; acumulado: Period };
  money: (value: number | null | undefined) => string;
  offerNote: string | null;
}) {
  const rows = [
    { id: "agendas", metrica: "Agendas", mes: String(rendimiento.mes.agendas), ant: String(rendimiento.anterior.agendas), acc: String(rendimiento.acumulado.agendas) },
    { id: "shows", metrica: "Asistencias", mes: String(rendimiento.mes.shows), ant: String(rendimiento.anterior.shows), acc: String(rendimiento.acumulado.shows) },
    { id: "noshow", metrica: "No asistieron", mes: String(rendimiento.mes.noShows), ant: String(rendimiento.anterior.noShows), acc: String(rendimiento.acumulado.noShows) },
    { id: "cierres", metrica: "Cierres", mes: String(rendimiento.mes.cierres), ant: String(rendimiento.anterior.cierres), acc: String(rendimiento.acumulado.cierres) },
    { id: "showrate", metrica: "Tasa de asistencia", mes: pctLabel(rendimiento.mes.showRate), ant: pctLabel(rendimiento.anterior.showRate), acc: pctLabel(rendimiento.acumulado.showRate) },
    { id: "close", metrica: "Tasa de cierre", mes: pctLabel(rendimiento.mes.closeRate), ant: pctLabel(rendimiento.anterior.closeRate), acc: pctLabel(rendimiento.acumulado.closeRate) },
    { id: "ventas", metrica: "Ventas", mes: money(rendimiento.mes.ventas), ant: money(rendimiento.anterior.ventas), acc: money(rendimiento.acumulado.ventas) },
    { id: "cash", metrica: "Cobrado", mes: money(rendimiento.mes.cash), ant: money(rendimiento.anterior.cash), acc: money(rendimiento.acumulado.cash) },
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg3">{PERIODO_TAB_NOTE}</p>
      {/* Mes and total both come from the payment-dated rollup shared with Período. */}
      <p className="text-sm text-fg2">
        {cobradoPeriodLine(money(rendimiento.mes.cash), money(rendimiento.acumulado.cash))}
      </p>
      <p className="text-[11px] text-fg3">{COBRADO_PERIOD_NOTE}</p>
      {offerNote && <p className="text-[11px] text-fg3">{offerNote}</p>}
      <p className="text-[11px] text-fg3">
        Ventas es la suma de los cierres que tienen monto, una persona una vez. Una asistencia o un precio solo mencionado no entra, así que ventas y cierres se mueven juntos.
      </p>
      <SheetTable
        columns={[
          { key: "metrica", label: "Métrica", width: 140, value: (row) => row.metrica },
          { key: "mes", label: "Mes en curso", width: 120, align: "right", value: (row) => row.mes },
          { key: "ant", label: "Mes anterior", width: 120, align: "right", value: (row) => row.ant },
          { key: "acc", label: "Acumulado", width: 120, align: "right", value: (row) => row.acc },
        ]}
        rows={rows}
        getId={(row) => row.id}
      />
    </div>
  );
}

function CashEditor({
  amount,
  disabled,
  onSave,
}: {
  amount: number | null;
  disabled: boolean;
  onSave: (amount: number) => Promise<void>;
}) {
  const [value, setValue] = useState(amount == null ? "" : String(Math.round(amount)));
  useEffect(() => {
    setValue(amount == null ? "" : String(Math.round(amount)));
  }, [amount]);
  return (
    <div className="min-w-0 max-w-full space-y-2 pt-2">
      <label className="text-sm text-fg3" htmlFor="cash-cobrado">
        Cobrado
      </label>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <Input
          id="cash-cobrado"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-8 w-28 min-w-0 max-w-full"
          placeholder="0"
        />
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={disabled}
          className="shrink-0"
          onClick={() => {
            const text = value.trim();
            const amount = text === "" ? 0 : Number(text.replace(/\./g, "").replace(",", "."));
            if (!Number.isFinite(amount) || amount < 0) return;
            void onSave(Math.round(amount));
          }}
        >
          Guardar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={disabled}
          className="shrink-0"
          onClick={() => void onSave(0)}
        >
          Poner en 0
        </Button>
      </div>
    </div>
  );
}

function AhoraGlance({
  now,
  money,
  onOpen,
}: {
  now: Record<string, number>;
  money: (value: number | null | undefined) => string;
  onOpen: (target: "activas" | "hoy" | "dinero") => void;
}) {
  const acciones = followupCardStatus(now.seguimientosHoy || 0, now.seguimientosVencidos || 0);
  const items: { id: "activas" | "hoy" | "dinero"; label: string; value: string }[] = [
    { id: "activas", label: "Leads activos", value: String(now.oportunidadesActivas || 0) },
    { id: "hoy", label: "Acciones de hoy", value: acciones },
    { id: "dinero", label: "Dinero en juego", value: money(now.dineroEnJuego) },
  ];
  return (
    <div className="space-y-2">
      <h2 className="text-sm text-fg3">Ahora mismo</h2>
      <div className="divide-y divide-separator1 border-t border-separator1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            className="flex w-full items-baseline justify-between gap-4 py-3 text-left"
          >
            <span className="text-sm text-fg0">{item.label}</span>
            <span className="text-right text-sm text-fg3">{item.value}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-fg3">{ACTIVA_EXPLAIN}</p>
    </div>
  );
}

function lastContactByClient(rows: OperacionRow[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.interna) continue;
    const key = foldLeadName(row.cliente);
    const day = String(row.fecha || "").slice(0, 10);
    if (!key || !day) continue;
    const prev = map.get(key) || "";
    if (day > prev) map.set(key, day);
  }
  return map;
}

function glanceFollowup(call: OperacionRow, rows: Followup[]) {
  return (
    followupForCall(call, rows) ||
    rows.find((row) => foldLeadName(row.cliente) === foldLeadName(call.cliente)) ||
    null
  );
}

function NameEditor({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const next = name.trim();
  return (
    <form
      className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (!next || next === initial.trim()) return;
        void onSave(next);
      }}
    >
      <label className="min-w-0 flex-1 space-y-1 text-xs text-fg3">
        Nombre
        <Input value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} />
      </label>
      <Button
        size="sm"
        type="submit"
        variant="outline"
        disabled={disabled || !next || next === initial.trim()}
      >
        {disabled ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}

function OperacionSheet({
  rows,
  scopeRows,
  money,
  selectedId,
  onSelect,
  selected,
  followups,
  busy,
  today,
  onPatch,
  onReopen,
  onCash,
  onRename,
  onDelete,
  empty = "Aún no hay llamadas en esta oferta.",
}: {
  rows: OperacionRow[];
  scopeRows?: OperacionRow[];
  money: (value: number | null | undefined) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selected: OperacionRow | null;
  followups: Followup[];
  busy: string | null;
  today: string;
  onPatch: (alertId: string, resultado: string, agenda?: boolean, nextAt?: string) => Promise<void>;
  onReopen: (alertId: string) => Promise<void>;
  onCash: (callId: string, amount: number) => Promise<void>;
  onRename: (args: { callId?: string; leadId?: string; name: string }) => Promise<void>;
  onDelete: (row: OperacionRow) => Promise<void>;
  empty?: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState<OperacionRow | null>(null);
  const contacts = useMemo(() => lastContactByClient(scopeRows || rows), [scopeRows, rows]);
  const columns: SheetColumn<OperacionRow>[] = [
    { key: "fecha", label: "Fecha", width: 90, value: (row) => row.fecha },
    { key: "cliente", label: "Cliente", width: 220, value: (row) => clienteVisible(row.cliente, row.titulo), mobileExtra: (row) => plainStatus(shownFollowupKind(row, glanceFollowup(row, followups))) },
    { key: "tel", label: "Teléfono", width: 110, value: (row) => row.telefono },
    { key: "canal", label: "Canal", width: 110, value: (row) => plainStatus(row.canal) },
    { key: "estado", label: "Estado", width: 130, value: (row) => plainStatus(row.estadoAgenda) },
    { key: "prox", label: "Próximo seguimiento", width: 150, value: (row) => row.fechaProximo },
    { key: "producto", label: "Producto", width: 160, value: (row) => plainStatus(row.producto || row.oferta) },
    { key: "venta", label: "Venta", width: 110, align: "right", value: (row) => money(row.venta) },
    { key: "modo", label: "Modo de pago", width: 130, value: (row) => plainStatus(row.modoPago) },
    { key: "cash", label: "Cobrado", width: 110, align: "right", value: (row) => money(row.cash) },
    { key: "req", label: "¿Seguimiento?", width: 130, value: (row) => plainStatus(row.requiereSeguimiento) },
    { key: "tipo", label: "Tipo de seguimiento", width: 180, hideOnMobile: true, value: (row) => plainStatus(shownFollowupKind(row, glanceFollowup(row, followups))) },
    { key: "acuerdo", label: "Acuerdo", width: 140, value: (row) => row.acuerdo },
    { key: "razon", label: "Razón no cierre", width: 140, value: (row) => row.razonNoCierre },
    { key: "notas", label: "Notas", width: 160, value: (row) => row.notas },
  ];
  const glanceOf = (row: OperacionRow) => {
    const followup = glanceFollowup(row, followups);
    return operacionGlance({
      fecha: row.fecha,
      ultimoContacto: contacts.get(foldLeadName(row.cliente)) || row.fecha,
      paso: followup?.paso,
      intentos: followup?.intentos,
      tipoSeguimiento: shownFollowupKind(row, followup),
      fechaProximo: followup?.proximo || row.fechaProximo,
    });
  };
  const selectedGlance = selected ? glanceOf(selected) : null;
  const confirmName = confirmDelete
    ? clienteVisible(confirmDelete.cliente, confirmDelete.titulo)
    : "";
  return (
    <div className="space-y-2">
      <div className="space-y-2 md:hidden">
        {rows.map((row) => {
          const glance = glanceOf(row);
          const active = selectedId === row.id;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
              className={`w-full min-w-0 rounded-2xl border px-3 py-3 text-left ${
                active ? "border-primary bg-primary/10" : "border-separator1 bg-bg1"
              }`}
            >
              <span className="block break-words text-sm text-fg0">
                {clienteVisible(row.cliente, row.titulo)}
                {row.fecha ? ` · ${row.fecha}` : ""}
              </span>
              <span className="mt-1 block break-words text-xs text-fg3">{glance.line}</span>
            </button>
          );
        })}
      </div>
      <SheetTable
        columns={columns}
        rows={rows}
        getId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={(row) => onSelect(row.id)}
        empty={empty}
      />
      {selected && (
        <div className="w-full min-w-0 max-w-full overflow-hidden border border-separator1 bg-bg1 p-3 pb-8 text-sm space-y-1">
          <div className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-bg1 py-1">
            <p className="text-[11px] uppercase tracking-wide text-fg3">Detalle de la fila</p>
            <Button type="button" size="sm" variant="outline" onClick={() => onSelect(selected.id)}>
              Cerrar
            </Button>
          </div>
          {(
            [
              ["Fecha", selected.fecha],
              ["Cliente", clienteVisible(selected.cliente, selected.titulo)],
              ["Teléfono", selected.telefono],
              ["Email", selected.email],
              ["Canal", plainStatus(selected.canal)],
              ["Estado", plainStatus(selected.estadoAgenda)],
              ["Paso", selectedGlance?.paso || "—"],
              ["Último contacto", selectedGlance?.ultimoContacto || selected.fecha],
              ["Qué sigue", selectedGlance?.siguiente || "—"],
              ["Próximo seguimiento", selected.fechaProximo],
              ["Producto", plainStatus(selected.producto || selected.oferta)],
              ["Venta", money(selected.venta)],
              ["Modo de pago", plainStatus(selected.modoPago)],
              ["Cobrado", money(selected.cash)],
              ["Saldo", money(selected.saldo)],
              ["¿Seguimiento?", plainStatus(selected.requiereSeguimiento)],
              ["Tipo de seguimiento", plainStatus(shownFollowupKind(selected, glanceFollowup(selected, followups)))],
              ["Acuerdo", selected.acuerdo],
              ["Razón no cierre", selected.razonNoCierre],
              ["Notas", selected.notas],
            ] as [string, string][]
          ).map(([label, value]) => (
            <p key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <span className="w-full shrink-0 text-fg3 sm:w-44">{label}</span>
              <span className="whitespace-pre-wrap break-words">{sheetCell(value)}</span>
            </p>
          ))}
          <NameEditor
            key={`nombre-${selected.id}-${clienteVisible(selected.cliente, selected.titulo)}`}
            initial={clienteVisible(selected.cliente, selected.titulo)}
            disabled={busy === "nombre"}
            onSave={(name) => onRename({ callId: selected.id, leadId: selected.leadId, name })}
          />
          <CashEditor
            key={selected.id}
            amount={selected.cash}
            disabled={Boolean(busy)}
            onSave={(amount) => onCash(selected.id, amount)}
          />
          {selected.seguimientoCerrado ? (
            <div className="space-y-2 pt-2">
              <p className="text-sm">
                Seguimiento marcado como {plainStatus(selected.seguimientoResultado) || "hecho"}
                {selected.seguimientoHecho ? ` · era ${selected.seguimientoHecho}` : ""}.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => void onReopen(`call:${selected.id}`)}
              >
                {busy === "reabrir" ? "Abriendo…" : "Reabrir"}
              </Button>
            </div>
          ) : selected.fechaProximo ? (
            <div className="pt-2">
              <FollowupActions
                targetId={
                  followupForCall(selected, followups)?.id || `call:${selected.id}`
                }
                tipo={followupForCall(selected, followups)?.tipo || selected.tipoSeguimiento}
                hilo={followupForCall(selected, followups)?.hilo || selected.tipoSeguimiento}
                askLost={Boolean(followupForCall(selected, followups)?.askLost)}
                suggested={
                  followupForCall(selected, followups)?.suggestedNext || selected.fechaProximo
                }
                today={today}
                busy={busy}
                cliente={selected.cliente}
                lostCount={openFollowupCount(scopeRows || rows, selected.leadId || "", selected.id)}
                onPatch={onPatch}
              />
            </div>
          ) : null}
          {!selected.id.startsWith("lead:") && (
            <div className="pt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => setConfirmDelete(selected)}
              >
                Eliminar fila
              </Button>
            </div>
          )}
        </div>
      )}
      <Dialog open={Boolean(confirmDelete)} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar fila</DialogTitle>
            <DialogDescription>
              ¿Eliminar la fila de {confirmName} del {confirmDelete?.fecha || "sin fecha"}? Sale de
              Operación. El próximo y el estado del lead se recalculan con las filas que quedan. El
              lead no se borra.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy === "eliminar"}
              onClick={() => setConfirmDelete(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy === "eliminar" || !confirmDelete}
              onClick={() => {
                const row = confirmDelete;
                if (!row) return;
                setConfirmDelete(null);
                void onDelete(row);
              }}
            >
              {busy === "eliminar" ? "Eliminando…" : "Eliminar fila"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DashboardSheet({
  data,
  money,
  onOpenCall,
}: {
  data: Dash;
  money: (value: number | null | undefined) => string;
  onOpenCall: (id: string) => void;
}) {
  const mes = data.rendimiento?.mes;
  const total = data.rendimiento?.acumulado;
  const series = asList<NonNullable<Dash["evolucion"]>[number]>(data.evolucion);
  const deals = asList<NonNullable<NonNullable<Dash["ventasDetalle"]>["leads"]>[number]>(
    data.ventasDetalle?.leads,
  );
  const dealCount = data.ventasDetalle?.n ?? deals.length;
  const sinMonto = asList<NonNullable<NonNullable<Dash["ventasDetalle"]>["sinMonto"]>[number]>(
    data.ventasDetalle?.sinMonto,
  );
  const [showDeals, setShowDeals] = useState(false);
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <SectionHeading>Actividad</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard label="Agendas del mes" value={String(mes?.agendas || 0)} tone="brand" />
          <MetricCard label="Asistencias" value={String(mes?.shows || 0)} tone="brand" />
        </div>
      </div>
      <div className="space-y-4">
        <SectionHeading>Conversión</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Tasa de cierre" value={pctLabel(mes?.closeRate)} tone="brand" />
          <MetricCard label="Tasa de asistencia" value={pctLabel(mes?.showRate)} tone="brand" />
          <MetricCard label="Ticket promedio" value={money(total?.ticket)} tone="brand" />
        </div>
      </div>
      <div className="space-y-4">
        <SectionHeading>Dinero y comisiones</SectionHeading>
        <p className="text-[11px] text-fg3">
          Ventas cerradas con monto: suma de {dealCount}{" "}
          {dealCount === 1 ? "cierre con monto" : "cierres con monto"}, cada persona una vez, en todos los meses.
          Una asistencia, una segunda reunión o un precio solo mencionado no entra. Cobrado es el dinero que ya entró.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label="Ventas cerradas con monto" value={money(total?.ventas)} tone="brand" />
          <MetricCard label="Cobrado" value={money(total?.cash)} tone="money" />
          <MetricCard label="Dinero en juego" value={money(data.now?.dineroEnJuego)} tone="money" />
          <MetricCard label="Saldo por cobrar" value={money(data.now?.saldoPorCobrar || 0)} tone="money" />
          <MetricCard label="Comisión generada" value={money(data.comisionResumen?.generada)} tone="brand" />
          <MetricCard label="Comisión cobrada" value={money(data.comisionResumen?.cobrada)} tone="money" />
        </div>
        {sinMonto.length > 0 && (
          <p className="text-sm">
            {sinMonto.length === 1 ? (
              <button
                type="button"
                className="text-left text-tone-info underline-offset-2 hover:underline"
                onClick={() => sinMonto[0]?.id && onOpenCall(sinMonto[0].id)}
              >
                1 cierre sin monto: agrega el monto
              </button>
            ) : (
              <>
                <span>{sinMonto.length} cierres sin monto: agrega el monto</span>
                {sinMonto.map((row) => (
                  <button
                    key={row.id || row.cliente}
                    type="button"
                    className="ml-2 text-tone-info underline-offset-2 hover:underline"
                    onClick={() => row.id && onOpenCall(row.id)}
                  >
                    {row.cliente}
                  </button>
                ))}
              </>
            )}
          </p>
        )}
        <p className="text-[11px] text-fg3">{dineroEnJuegoNote(data.now?.pipelineLeads || 0)}</p>
        <PipelineDetail lines={asList<PipelineLine>(data.pipelineDetalle)} format={money} />
        <p className="text-[11px] text-fg3">{saldoPorCobrarNote(data.now?.saldoPorCobrar || 0)}</p>
        <button
          type="button"
          className="text-sm text-tone-info underline-offset-2 hover:underline"
          onClick={() => setShowDeals((open) => !open)}
        >
          {showDeals ? "Ocultar los cierres" : "Ver los cierres"}
        </button>
        {showDeals && (
          <ul className="divide-y divide-separator1 border-t border-separator1 text-sm">
            {deals.length === 0 ? (
              <li className="py-3 text-fg3">Ningún cierre con monto. Un precio solo mencionado no entra.</li>
            ) : (
              deals.map((deal) => (
                <li key={deal.id || `${deal.cliente}-${deal.fecha}`}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 py-3 text-left sm:flex-row sm:items-baseline sm:justify-between"
                    onClick={() => deal.id && onOpenCall(deal.id)}
                  >
                    <span className="break-words">{deal.cliente}</span>
                    <span className="text-fg3">
                      {deal.fecha || "sin fecha"}
                      {deal.oferta ? ` · ${deal.oferta}` : ""} · {money(deal.venta)}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <div className="space-y-4">
        <SectionHeading>En curso</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard label="Oportunidades activas" value={String(data.now?.oportunidadesActivas || 0)} tone="brand" />
          <MetricCard label="Llamadas agendadas" value={String(data.now?.agendasFuturas || 0)} tone="brand" />
          <MetricCard label="Seguimientos abiertos" value={String(data.followups?.length || 0)} tone="brand" />
          <MetricCard label="Cierres del mes" value={String(mes?.cierres || 0)} tone="brand" />
        </div>
        <p className="text-[11px] text-fg3">{ACTIVA_EXPLAIN}</p>
      </div>
      <div className="space-y-4">
        <SectionHeading>Evolución</SectionHeading>
        <BarChart
          title="Agendas, asistencias y cierres"
          series={[
            { label: "Agendas", tone: "brand" },
            { label: "Asistencias", tone: "muted" },
            { label: "Cierres", tone: "neutral" },
          ]}
          rows={series.map((row) => ({
            label: monthLabel(row.mes),
            values: [row.agendas, row.shows, row.cierres],
          }))}
        />
        <BarChart
          title="Ventas y cobrado"
          series={[
            { label: "Ventas", tone: "brand" },
            { label: "Cobrado", tone: "money" },
          ]}
          rows={series.map((row) => ({
            label: monthLabel(row.mes),
            values: [row.ventas, row.cash],
          }))}
        />
      </div>
      <div className="space-y-4">
        <SectionHeading>Desglose</SectionHeading>
        <SheetTable
          columns={[
            { key: "oferta", label: "Oferta", width: 180, value: (row) => row.oferta },
            { key: "cierres", label: "Cierres", width: 80, align: "right", value: (row) => row.cierres },
            { key: "ventas", label: "Ventas", width: 110, align: "right", value: (row) => money(row.ventas) },
            { key: "cash", label: "Cobrado", width: 120, align: "right", value: (row) => money(row.cash) },
          ]}
          rows={asList<NonNullable<Dash["desglose"]>["porOferta"][number]>(data.desglose?.porOferta)}
          getId={(row) => row.oferta}
          empty="Sin desglose por oferta."
        />
        <SheetTable
          columns={[
            { key: "razon", label: "Razón de no cierre", width: 220, value: (row) => row.razon },
            { key: "count", label: "Veces", width: 70, align: "right", value: (row) => row.count },
          ]}
          rows={asList<NonNullable<Dash["desglose"]>["razonNoCierre"][number]>(data.desglose?.razonNoCierre)}
          getId={(row) => `${row.razon}-${row.count}`}
          empty="Sin datos aún."
        />
      </div>
    </div>
  );
}

function isSegunda(value: string) {
  return isMeetingFollowup(value);
}

function sameFollowupText(shown: string, note: string) {
  const norm = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s*·\s*(vencido|pendiente de hoy)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  const left = norm(shown);
  const right = norm(note);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function followupForCall(call: OperacionRow, rows: Followup[]) {
  return rows.find((row) => row.callId === call.id || row.id === `call:${call.id}`) || null;
}

function FollowupActions({
  targetId,
  tipo,
  hilo,
  askLost,
  suggested,
  today,
  busy,
  initialAsk,
  cliente,
  lostCount,
  onPatch,
}: {
  targetId: string;
  tipo: string;
  hilo: string;
  askLost: boolean;
  suggested: string;
  today: string;
  busy: string | null;
  initialAsk?: string | null;
  cliente: string;
  lostCount: number;
  onPatch: (
    alertId: string,
    resultado: string,
    agenda?: boolean,
    nextAt?: string,
    reason?: { id: string; note: string },
  ) => Promise<void>;
}) {
  const [ask, setAsk] = useState<string | null>(initialAsk || null);
  const [day, setDay] = useState((suggested || "").slice(0, 10));
  const [lostReason, setLostReason] = useState("");
  const [lostNote, setLostNote] = useState("");
  const disabled = Boolean(busy);
  const segunda = isSegunda(`${hilo} ${tipo}`);
  const agenda = tipo === "AGENDA_CHECK";

  useEffect(() => {
    if (initialAsk) {
      setAsk(initialAsk);
      setDay((suggested || "").slice(0, 10));
    }
  }, [initialAsk, suggested, targetId]);

  const saveAsk = () => {
    if (!ask || !day) return;
    void onPatch(targetId, ask, false, day);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {agenda ? (
          <>
            <Button className="w-full sm:w-auto whitespace-normal h-auto" size="sm" variant="primary" disabled={disabled} onClick={() => void onPatch(targetId, "SHOW", true)}>
              {busy === "SHOW" ? "Guardando…" : "Asistió"}
            </Button>
            <Button className="w-full sm:w-auto whitespace-normal h-auto" size="sm" variant="outline" disabled={disabled} onClick={() => void onPatch(targetId, "NO SHOW", true)}>
              No asistió
            </Button>
            <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={disabled} onClick={() => void onPatch(targetId, "REPROGRAMA", true)}>
              Reprogramó
            </Button>
          </>
        ) : (
          <>
            <Button className="w-full sm:w-auto" size="sm" variant="primary" disabled={disabled} onClick={() => void onPatch(targetId, "hecho")}>
              {busy === "hecho" ? "Guardando…" : "Hecho"}
            </Button>
            <Button
              className="w-full sm:w-auto"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setAsk("no_contesto");
                setDay((suggested || addCalendarDays(today, 1)).slice(0, 10));
              }}
            >
              No contestó
            </Button>
            {segunda ? (
              <>
                <Button className="w-full sm:w-auto whitespace-normal h-auto" size="sm" variant="outline" disabled={disabled} onClick={() => void onPatch(targetId, "mostro")}>
                  {busy === "mostro" ? "Guardando…" : "Asistió"}
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setAsk("no_mostro");
                    setDay((suggested || addCalendarDays(today, 1)).slice(0, 10));
                  }}
                >
                  No asistió
                </Button>
                <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={disabled} onClick={() => setAsk("perdido")}>
                  {busy === "perdido" ? "Guardando…" : "Perdido"}
                </Button>
              </>
            ) : askLost ? (
              <>
                <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={disabled} onClick={() => setAsk("perdido")}>
                  Perdido
                </Button>
                <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={disabled} onClick={() => void onPatch(targetId, "cerro")}>
                  Cerró
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="w-full sm:w-auto"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setAsk("reprogramado");
                    setDay((suggested || addCalendarDays(today, 1)).slice(0, 10));
                  }}
                >
                  Reprogramar
                </Button>
                <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={disabled} onClick={() => void onPatch(targetId, "cerro")}>
                  {busy === "cerro" ? "Guardando…" : "Cerró"}
                </Button>
                <Button className="w-full sm:w-auto" size="sm" variant="outline" disabled={disabled} onClick={() => setAsk("perdido")}>
                  {busy === "perdido" ? "Guardando…" : "Perdido"}
                </Button>
              </>
            )}
          </>
        )}
      </div>
      {ask === "perdido" && (
        <div className="space-y-3 rounded-xl border border-separator1 p-3">
          <p className="text-sm">{lostScopeMessage(cliente, lostCount)}</p>
          <p className="text-xs text-fg3">Hecho, No contestó, Mostró y No mostró cambian solo esta fila. Perdido cierra los seguimientos de este lead.</p>
          <div className="flex flex-wrap gap-2">
            {LOST_REASONS.map((reason) => (
              <Button
                key={reason.id}
                size="sm"
                type="button"
                variant={lostReason === reason.id ? "primary" : "outline"}
                onClick={() => setLostReason(reason.id)}
              >
                {reason.label}
              </Button>
            ))}
          </div>
          <Input
            value={lostNote}
            onChange={(event) => setLostNote(event.target.value)}
            placeholder={lostReason === "otro" ? "Escribe el motivo" : "Nota, si quieres"}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              type="button"
              disabled={disabled}
              onClick={() => void onPatch(targetId, "perdido", false, undefined, { id: lostReason, note: lostNote })}
            >
              {busy === "perdido" ? "Guardando…" : "Marcar perdido"}
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={() => setAsk(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {ask && ask !== "perdido" && (
        <div className="space-y-2 rounded-xl border border-separator1 p-3">
          <p className="text-sm">
            {ask === "no_contesto"
              ? "No contestó. Solo esta fila sigue pendiente. ¿Para cuándo la retomas?"
              : ask === "no_mostro"
                ? "No asistió. Solo esta fila sigue pendiente. ¿Para cuándo?"
                : "¿Para cuándo reprogramas esta fila?"}
          </p>
          <Input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" type="button" onClick={() => setDay(addCalendarDays(today, 1))}>
              Mañana
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={() => setDay(addCalendarDays(today, 2))}>
              En 2 días
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={() => setDay(addCalendarDays(today, 7))}>
              En una semana
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" type="button" disabled={disabled || !day} onClick={saveAsk}>
              {busy === ask ? "Guardando…" : "Guardar fecha"}
            </Button>
            <Button size="sm" variant="outline" type="button" onClick={() => setAsk(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SeguimientosSheet({
  rows,
  operacion,
  money,
  now,
  today,
  busy,
  selected,
  onSelect,
  onPick,
  onPatch,
  onRename,
  empty = "No hay seguimientos abiertos.",
}: {
  rows: Followup[];
  operacion: OperacionRow[];
  money: (value: number | null | undefined) => string;
  now: Record<string, number>;
  today: string;
  busy: string | null;
  selected: Followup | null;
  onSelect: (id: string) => void;
  onPick: (alertId: string, optionId: string) => Promise<void>;
  onPatch: (
    alertId: string,
    resultado: string,
    agenda?: boolean,
    nextAt?: string,
    reason?: { id: string; note: string },
  ) => Promise<void>;
  onRename: (args: { callId?: string; leadId?: string; name: string }) => Promise<void>;
  empty?: string;
}) {
  const [askFor, setAskFor] = useState<{ id: string; kind: "no_contesto" | "no_mostro" } | null>(
    null,
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg3" aria-live="polite">
        {seguimientosHeader(
          followupCardStatus(now.seguimientosHoy || 0, now.seguimientosVencidos || 0),
          money(now.saldoPorCobrar || 0),
        )}
      </p>
      <HelpNote>
        <p>{SEGUIMIENTOS_SALDO_NOTE}</p>
        <p>Hecho cierra este seguimiento: sale de la lista y deja de contar en pendientes y en dinero en juego.</p>
        <p>No contestó anota que no respondió y te pide otra fecha, para que el lead no se pierda. Asistió y No asistió son de la reunión.</p>
        <p>Perdido cierra el hilo. Cerró, en una decisión, lo pasa a cobro si todavía queda saldo.</p>
      </HelpNote>
      {selected && (
        <div className="rounded-2xl border border-separator1 bg-bg1 p-3 pb-8 space-y-3">
          <div className="sticky top-0 z-20 flex items-start justify-between gap-2 bg-bg1 py-1">
            <div className="min-w-0">
              <p className="text-sm break-words">{selected.cliente}</p>
              <p className="text-xs text-fg3 break-words">
                {plainStatus(selected.hilo || selected.tipo)}
                {selected.proximaAccion ? ` · ${selected.proximaAccion}` : ""}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => onSelect(selected.id)}>
              Cerrar
            </Button>
          </div>
          {selected.contexto &&
            !sameFollowupText(
              `${selected.proximaAccion || ""} ${selected.acuerdo || ""}`,
              selected.contexto,
            ) && <p className="text-xs text-fg3 break-words">{selected.contexto}</p>}
          {selected.tipo !== "AGENDA_CHECK" && (selected.opciones || []).length > 0 ? (
            <FollowupPicker
              alertId={selected.id}
              options={selected.opciones || []}
              selectedId={selected.selectedId}
              phone={selected.telefono}
              disabled={Boolean(busy)}
              onChoose={onPick}
            />
          ) : (
            selected.mensajeSugerido && (
              <p className="text-xs whitespace-pre-wrap break-words">{selected.mensajeSugerido}</p>
            )
          )}
          <NameEditor
            key={`nombre-${selected.id}-${selected.cliente}`}
            initial={selected.cliente}
            disabled={busy === "nombre"}
            onSave={(name) =>
              onRename({ callId: selected.callId, leadId: selected.leadId, name })
            }
          />
          <FollowupActions
            key={selected.id}
            targetId={selected.id}
            tipo={selected.tipo}
            hilo={selected.hilo || ""}
            askLost={Boolean(selected.askLost)}
            suggested={selected.suggestedNext || selected.proximo || ""}
            today={today}
            busy={busy}
            cliente={selected.cliente}
            lostCount={openFollowupCount(
              operacion,
              selected.leadId || "",
              selected.callId || "",
            )}
            initialAsk={askFor?.id === selected.id ? askFor.kind : null}
            onPatch={onPatch}
          />
        </div>
      )}
      <SheetTable
        columns={[
          {
            key: "cliente",
            label: "Cliente",
            width: 220,
            value: (row) => row.cliente,
            mobileExtra: (row) => plainStatus(row.hilo || row.tipo),
          },
          { key: "hilo", label: "Tipo", width: 150, hideOnMobile: true, value: (row) => plainStatus(row.hilo || row.tipo) },
          {
            key: "paso",
            label: "Paso",
            width: 80,
            value: (row) => derivedPaso({ paso: row.paso, tipo: row.hilo || row.tipo, intentos: row.intentos }) || "—",
          },
          { key: "toque", label: "Último toque", width: 180, value: (row) => row.ultimoToque || "sin toques" },
          { key: "accion", label: "Próxima acción", width: 240, value: (row) => row.proximaAccion || row.queHacer || row.acuerdo || row.question },
          { key: "juego", label: "En juego", width: 120, align: "right", value: (row) => (row.enJuego ? money(row.enJuego) : "—") },
          { key: "temp", label: "Temperatura", width: 120, value: (row) => row.temperatura || "—" },
        ]}
        rows={rows}
        getId={(row) => row.id}
        selectedId={selected?.id || null}
        onRowClick={(row) => onSelect(row.id)}
        empty={empty}
        trailing={{
          label: "Acción",
          width: 104,
          render: (row) => {
            if (row.tipo === "AGENDA_CHECK") {
              return <span className="text-xs text-fg3">Abre la fila</span>;
            }
            const meeting = isMeetingFollowup(row.tipo, row.hilo || "");
            return (
              <div className="flex w-full flex-col gap-1">
                {meeting ? (
                  <>
                    <Button
                      className="h-8 w-full px-0.5 text-[11px]"
                      size="sm"
                      variant="primary"
                      disabled={Boolean(busy)}
                      onClick={() => void onPatch(row.id, "mostro")}
                    >
                      {busy === "mostro" ? "…" : "Asistió"}
                    </Button>
                    <Button
                      className="h-8 w-full px-0.5 text-[11px]"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        if (selected?.id !== row.id) onSelect(row.id);
                        setAskFor({ id: row.id, kind: "no_mostro" });
                      }}
                    >
                      No asistió
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      className="h-8 w-full px-0.5 text-[11px]"
                      size="sm"
                      variant="primary"
                      disabled={Boolean(busy)}
                      onClick={() => void onPatch(row.id, "hecho")}
                    >
                      {busy === "hecho" ? "…" : "Hecho"}
                    </Button>
                    <Button
                      className="h-8 w-full px-0.5 text-[11px]"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        if (selected?.id !== row.id) onSelect(row.id);
                        setAskFor({ id: row.id, kind: "no_contesto" });
                      }}
                    >
                      No contestó
                    </Button>
                  </>
                )}
              </div>
            );
          },
        }}
      />
    </div>
  );
}

function ComisionesSheet({
  rows,
  resumen,
  money,
  onPaid,
  empty = "Todavía no hay dinero cobrado en llamadas.",
}: {
  rows: Commission[];
  resumen?: Dash["comisionResumen"];
  money: (value: number | null | undefined) => string;
  onPaid: (id: string) => Promise<void>;
  empty?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === openId) || null;
  return (
    <div className="space-y-2">
      {resumen && (
        <p className="text-sm">
          Generada {money(resumen.generada)} · cobrada {money(resumen.cobrada)} ·
          pendiente {money(resumen.pendiente)} ({pctLabel(resumen.pctCobrado)})
        </p>
      )}
      <SheetTable
        columns={[
          { key: "fecha", label: "Fecha", width: 90, value: (row) => row.fecha?.slice(0, 10) || "—" },
          { key: "cliente", label: "Cliente", width: 220, value: (row) => row.cliente },
          { key: "oferta", label: "Oferta", width: 140, value: (row) => row.oferta },
          { key: "venta", label: "Venta", width: 90, align: "right", value: (row) => money(row.venta) },
          { key: "cash", label: "Cobrado", width: 110, align: "right", value: (row) => money(row.cash) },
          { key: "pct", label: "%", width: 60, align: "right", value: (row) => pctLabel(row.pct) },
          { key: "gen", label: "Generada", width: 100, align: "right", value: (row) => money(row.generada) },
          { key: "cob", label: "Cobrada", width: 100, align: "right", value: (row) => money(row.cobrada) },
          { key: "estado", label: "Estado", width: 110, value: (row) => plainStatus(row.estado) },
          { key: "fcobro", label: "Fecha cobro", width: 90, value: (row) => row.fechaCobro?.slice(0, 10) },
        ]}
        rows={rows}
        getId={(row) => row.id}
        selectedId={openId}
        onRowClick={(row) => setOpenId(openId === row.id ? null : row.id)}
        empty={empty}
      />
      {selected && plainStatus(selected.estado) !== "Cobrada" && (
        <div className="border border-separator1 bg-bg1 p-3">
          <Button size="sm" variant="outline" onClick={() => void onPaid(selected.id)}>
            Marcar cobrada
          </Button>
        </div>
      )}
    </div>
  );
}
