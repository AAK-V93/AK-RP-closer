"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";
import { BarChart } from "@/components/bar-chart";
import { HelpNote, MetricCard, SectionHeading } from "@/components/metric-card";
import { ProjectionCard } from "@/components/projection-card";
import { SheetTable, sheetCell, type SheetColumn } from "@/components/crm-sheet";
import { Input } from "@/components/ui/input";
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
  question: string;
  dueAt: string;
  tipo: string;
  hilo?: string;
  paso?: string;
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
  readyCrm?: boolean;
  missingCrm?: { question: string } | null;
  now?: Record<string, number>;
  rendimiento?: { mes: Period; anterior: Period; acumulado: Period };
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
  { id: "dashboard", label: "Dashboard" },
  { id: "seguimientos", label: "Seguimientos" },
  { id: "comisiones", label: "Comisiones" },
];

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

  const load = () =>
    fetch("/api/crm")
      .then((r) => r.json())
      .then(setData)
      .catch(() => undefined);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "") as ModuleId;
    if (MODULES.some((item) => item.id === hash)) setModule(hash);
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

  const patch = async (alertId: string, resultado: string, agenda?: boolean) => {
    await fetch("/api/crm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        agenda
          ? { alertId, action: "agenda", agendaEstado: resultado }
          : { alertId, action: "outcome", resultado },
      ),
    });
    await load();
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

  const offers = data?.offers || [];
  const currency =
    offers.find((row) => row.productName === offer)?.currency ||
    offers[0]?.currency ||
    "USD";
  const money = (value: number | null | undefined) => moneyLabel(value, currency);

  const operacionBase = useMemo(
    () => (data?.operacion || []).filter((row) => matchesOffer(row.oferta || row.producto, offer)),
    [data?.operacion, offer],
  );
  const followupsBase = useMemo(
    () => (data?.followups || []).filter((row) => matchesOffer(row.oferta || "", offer)),
    [data?.followups, offer],
  );
  const commissionsBase = useMemo(
    () => (data?.commissions || []).filter((row) => matchesOffer(row.oferta || "", offer)),
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
    return operacionBase.map((row) => ({
      name: row.cliente,
      date: row.fecha,
      estado: row.estadoAgenda,
    }));
  }, [module, operacionBase, followupsBase, commissionsBase]);
  const operacion = useMemo(
    () =>
      operacionBase.filter((row) =>
        matchesCrmListFilter(
          { name: row.cliente, date: row.fecha, estado: row.estadoAgenda },
          listFilter,
        ),
      ),
    [operacionBase, listFilter],
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
        ) : !data ? (
          <p className="text-sm text-fg3">Cargando…</p>
        ) : (
          <>
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
                    onClick={() => setOffer(row.productName)}
                  >
                    {row.productName}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1 border-b border-separator1 pb-2">
              {MODULES.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
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
                money={money}
                selectedId={openCall}
                onSelect={(id) => setOpenCall(openCall === id ? null : id)}
                selected={selectedCall}
                empty={
                  operacionBase.length > 0 && operacion.length === 0
                    ? "Nada con estos filtros."
                    : "Aún no hay llamadas en esta oferta."
                }
              />
            )}
            {module === "dashboard" && <DashboardSheet data={data} money={money} />}
            {module === "seguimientos" && (
              <SeguimientosSheet
                rows={followups}
                money={money}
                selected={selectedFollowup}
                onSelect={(id) => setOpenAlert(openAlert === id ? null : id)}
                onPick={pickScript}
                onPatch={patch}
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
                    : "Todavía no hay cash cobrado en llamadas."
                }
              />
            )}
          </>
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
      <label className="space-y-1">
        <span className="block text-[11px] uppercase tracking-wide text-fg3">Nombre</span>
        <Input
          value={filter.q}
          placeholder="Buscar"
          className="h-8 w-44"
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
      <p className="pb-1.5 text-xs text-fg3">
        {shown} de {rows.length}
      </p>
      {active && (
        <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_CRM_FILTER)}>
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
      <span className="block text-[11px] uppercase tracking-wide text-fg3">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded border border-separator2 bg-bg1 px-2 text-sm text-fg2"
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
  const pending = (now.seguimientosHoy || 0) + (now.seguimientosVencidos || 0);
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Pendientes de hoy"
            value={String(pending)}
            tone={pending > 0 ? "attention" : "muted"}
          />
          <MetricCard label="Agendas de hoy" value={String(now.agendasHoy || 0)} tone="brand" />
          <MetricCard
            label="Dinero en juego"
            value={money(now.dineroEnJuego)}
            tone={(now.dineroEnJuego || 0) > 0 ? "attention" : "muted"}
          />
          <MetricCard
            label="Cash pendiente de cobro"
            value={money(now.cashPendiente)}
            tone={(now.cashPendiente || 0) > 0 ? "attention" : "muted"}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Comisión pendiente" value={money(now.comisionPendiente)} tone="brand" />
          <MetricCard label="Oportunidades activas" value={String(now.oportunidadesActivas || 0)} tone="brand" />
          <MetricCard label="Agendas futuras" value={String(now.agendasFuturas || 0)} tone="brand" />
        </div>
        <HelpNote>
          <p>Pendientes de hoy son los seguimientos que toca hacer hoy, también los que ya debían salir.</p>
          <p>Dinero en juego es lo que todavía puedes cerrar o cobrar en esos seguimientos. Cash pendiente es lo ya acordado que aún no entró.</p>
          <p>Comisión pendiente es tu parte de ese cash. Agendas de hoy y futuras son llamadas en el calendario, no seguimientos escritos.</p>
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
    { id: "shows", metrica: "Shows", mes: String(rendimiento.mes.shows), ant: String(rendimiento.anterior.shows), acc: String(rendimiento.acumulado.shows) },
    { id: "noshow", metrica: "No shows", mes: String(rendimiento.mes.noShows), ant: String(rendimiento.anterior.noShows), acc: String(rendimiento.acumulado.noShows) },
    { id: "cierres", metrica: "Cierres", mes: String(rendimiento.mes.cierres), ant: String(rendimiento.anterior.cierres), acc: String(rendimiento.acumulado.cierres) },
    { id: "showrate", metrica: "Show rate", mes: pctLabel(rendimiento.mes.showRate), ant: pctLabel(rendimiento.anterior.showRate), acc: pctLabel(rendimiento.acumulado.showRate) },
    { id: "close", metrica: "Close rate", mes: pctLabel(rendimiento.mes.closeRate), ant: pctLabel(rendimiento.anterior.closeRate), acc: pctLabel(rendimiento.acumulado.closeRate) },
    { id: "ventas", metrica: "Ventas", mes: money(rendimiento.mes.ventas), ant: money(rendimiento.anterior.ventas), acc: money(rendimiento.acumulado.ventas) },
    { id: "cash", metrica: "Cash", mes: money(rendimiento.mes.cash), ant: money(rendimiento.anterior.cash), acc: money(rendimiento.acumulado.cash) },
  ];
  return (
    <div className="space-y-2">
      {offerNote && <p className="text-[11px] text-fg3">{offerNote}</p>}
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

function OperacionSheet({
  rows,
  money,
  selectedId,
  onSelect,
  selected,
  empty = "Aún no hay llamadas en esta oferta.",
}: {
  rows: OperacionRow[];
  money: (value: number | null | undefined) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selected: OperacionRow | null;
  empty?: string;
}) {
  const columns: SheetColumn<OperacionRow>[] = [
    { key: "fecha", label: "Fecha", width: 90, value: (row) => row.fecha },
    { key: "cliente", label: "Cliente", width: 160, value: (row) => row.cliente },
    { key: "tel", label: "Teléfono", width: 110, value: (row) => row.telefono },
    { key: "canal", label: "Canal", width: 80, value: (row) => row.canal },
    { key: "estado", label: "Estado", width: 120, value: (row) => plainStatus(row.estadoAgenda) },
    { key: "prox", label: "Próx. seg.", width: 90, value: (row) => row.fechaProximo },
    { key: "producto", label: "Producto", width: 140, value: (row) => row.producto || row.oferta },
    { key: "venta", label: "Venta", width: 90, align: "right", value: (row) => money(row.venta) },
    { key: "modo", label: "Modo pago", width: 100, value: (row) => row.modoPago },
    { key: "cash", label: "Cash", width: 90, align: "right", value: (row) => money(row.cash) },
    { key: "req", label: "Req. seg.", width: 70, value: (row) => row.requiereSeguimiento },
    { key: "tipo", label: "Tipo seg.", width: 100, value: (row) => row.tipoSeguimiento },
    { key: "acuerdo", label: "Acuerdo", width: 140, value: (row) => row.acuerdo },
    { key: "razon", label: "Razón no cierre", width: 140, value: (row) => row.razonNoCierre },
    { key: "notas", label: "Notas", width: 160, value: (row) => row.notas },
  ];
  return (
    <div className="space-y-2">
      <SheetTable
        columns={columns}
        rows={rows}
        getId={(row) => row.id}
        selectedId={selectedId}
        onRowClick={(row) => onSelect(row.id)}
        empty={empty}
      />
      {selected && (
        <div className="border border-separator1 bg-bg1 p-3 text-sm space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-fg3">Detalle de la fila</p>
          {(
            [
              ["Fecha", selected.fecha],
              ["Cliente", selected.cliente],
              ["Teléfono", selected.telefono],
              ["Email", selected.email],
              ["Canal", selected.canal],
              ["Estado", plainStatus(selected.estadoAgenda)],
              ["Próximo seguimiento", selected.fechaProximo],
              ["Producto", selected.producto || selected.oferta],
              ["Venta", money(selected.venta)],
              ["Modo de pago", selected.modoPago],
              ["Cash", money(selected.cash)],
              ["Saldo", money(selected.saldo)],
              ["Req. seguimiento", selected.requiereSeguimiento],
              ["Tipo", plainStatus(selected.tipoSeguimiento)],
              ["Acuerdo", selected.acuerdo],
              ["Razón no cierre", selected.razonNoCierre],
              ["Notas", selected.notas],
            ] as [string, string][]
          ).map(([label, value]) => (
            <p key={label} className="flex gap-3">
              <span className="w-44 shrink-0 text-fg3">{label}</span>
              <span className="whitespace-pre-wrap break-words">{sheetCell(value)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function DashboardSheet({
  data,
  money,
}: {
  data: Dash;
  money: (value: number | null | undefined) => string;
}) {
  const mes = data.rendimiento?.mes;
  const series = data.evolucion || [];
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <SectionHeading>Actividad</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard label="Agendas del mes" value={String(mes?.agendas || 0)} tone="brand" />
          <MetricCard label="Shows" value={String(mes?.shows || 0)} tone="brand" />
        </div>
      </div>
      <div className="space-y-4">
        <SectionHeading>Conversión</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Close rate" value={pctLabel(mes?.closeRate)} tone="brand" />
          <MetricCard label="Show rate" value={pctLabel(mes?.showRate)} tone="brand" />
          <MetricCard label="Ticket promedio" value={money(mes?.ticket)} tone="brand" />
        </div>
      </div>
      <div className="space-y-4">
        <SectionHeading>Dinero y comisiones</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Ventas" value={money(mes?.ventas)} tone="brand" />
          <MetricCard label="Cash cobrado" value={money(mes?.cash)} tone="money" />
          <MetricCard label="Comisión generada" value={money(data.comisionResumen?.generada)} tone="brand" />
          <MetricCard label="Comisión cobrada" value={money(data.comisionResumen?.cobrada)} tone="money" />
        </div>
      </div>
      <div className="space-y-4">
        <SectionHeading>Pipeline</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MetricCard label="Agendas futuras" value={String(data.now?.agendasFuturas || 0)} tone="brand" />
          <MetricCard label="Cierres del mes" value={String(mes?.cierres || 0)} tone="brand" />
        </div>
      </div>
      <div className="space-y-4">
        <SectionHeading>Evolución</SectionHeading>
        <BarChart
          title="Agendas, shows y cierres"
          series={[
            { label: "Agendas", tone: "brand" },
            { label: "Shows", tone: "muted" },
            { label: "Cierres", tone: "neutral" },
          ]}
          rows={series.map((row) => ({
            label: monthLabel(row.mes),
            values: [row.agendas, row.shows, row.cierres],
          }))}
        />
        <BarChart
          title="Ventas y cash cobrado"
          series={[
            { label: "Ventas", tone: "brand" },
            { label: "Cash cobrado", tone: "money" },
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
            { key: "cash", label: "Cash", width: 110, align: "right", value: (row) => money(row.cash) },
          ]}
          rows={data.desglose?.porOferta || []}
          getId={(row) => row.oferta}
          empty="Sin desglose por oferta."
        />
        <SheetTable
          columns={[
            { key: "razon", label: "Razón de no cierre", width: 220, value: (row) => row.razon },
            { key: "count", label: "N", width: 60, align: "right", value: (row) => row.count },
          ]}
          rows={data.desglose?.razonNoCierre || []}
          getId={(row) => `${row.razon}-${row.count}`}
          empty="Sin datos aún."
        />
      </div>
    </div>
  );
}

function SeguimientosSheet({
  rows,
  money,
  selected,
  onSelect,
  onPick,
  onPatch,
  empty = "No hay seguimientos abiertos.",
}: {
  rows: Followup[];
  money: (value: number | null | undefined) => string;
  selected: Followup | null;
  onSelect: (id: string) => void;
  onPick: (alertId: string, optionId: string) => Promise<void>;
  onPatch: (alertId: string, resultado: string, agenda?: boolean) => Promise<void>;
  empty?: string;
}) {
  return (
    <div className="space-y-4">
      <HelpNote>
        <p>El paso dice en qué mensaje de la secuencia vas, por ejemplo 2 de 4. El último toque es cuándo escribiste y qué pasó, en palabras.</p>
        <p>Si no responde, marcas No contestó y avanza al siguiente paso. Si ya tocaba hacerlo, la próxima acción dice pendiente de hoy.</p>
        <p>Perdido cierra el hilo. Cerró, en una decisión, lo pasa a cobro si todavía queda saldo.</p>
      </HelpNote>
      <SheetTable
        columns={[
          { key: "cliente", label: "Cliente", width: 160, value: (row) => row.cliente },
          { key: "hilo", label: "Tipo", width: 140, value: (row) => plainStatus(row.hilo || row.tipo) },
          { key: "paso", label: "Paso", width: 80, value: (row) => row.paso || "—" },
          { key: "toque", label: "Último toque", width: 180, value: (row) => row.ultimoToque || "sin toques" },
          { key: "accion", label: "Próxima acción", width: 240, value: (row) => row.proximaAccion || row.queHacer || row.acuerdo || row.question },
          { key: "juego", label: "En juego", width: 100, align: "right", value: (row) => (row.enJuego ? money(row.enJuego) : "—") },
          { key: "temp", label: "Temperatura", width: 110, value: (row) => row.temperatura || "—" },
        ]}
        rows={rows}
        getId={(row) => row.id}
        selectedId={selected?.id || null}
        onRowClick={(row) => onSelect(row.id)}
        empty={empty}
      />
      {selected && (
        <div className="border border-separator1 bg-bg1 p-3 space-y-3">
          {selected.contexto && <p className="text-xs text-fg3">{selected.contexto}</p>}
          {selected.tipo !== "AGENDA_CHECK" && (selected.opciones || []).length > 0 ? (
            <FollowupPicker
              alertId={selected.id}
              options={selected.opciones || []}
              selectedId={selected.selectedId}
              phone={selected.telefono}
              onChoose={onPick}
            />
          ) : (
            selected.mensajeSugerido && (
              <p className="text-xs whitespace-pre-wrap">{selected.mensajeSugerido}</p>
            )
          )}
          <div className="flex flex-wrap gap-1">
            {(selected.tipo === "AGENDA_CHECK"
              ? (
                  [
                    ["SHOW", "Show"],
                    ["NO SHOW", "No show"],
                    ["REPROGRAMA", "Reprogramó"],
                  ] as const
                )
              : selected.askLost
                ? (
                    [
                      ["perdido", "Perdido"],
                      ["cerro", "Cerró"],
                    ] as const
                  )
                : selected.hilo === "SEGUNDA_REUNION"
                  ? (
                      [
                        ["mostro", "Mostró"],
                        ["no_mostro", "No mostró"],
                        ["perdido", "Perdido"],
                      ] as const
                    )
                  : (
                      [
                        ["hecho", "Hecho"],
                        ["no_contesto", "No contestó"],
                        ["reprogramado", "Reprogramar"],
                        ["cerro", "Cerró"],
                        ["perdido", "Perdido"],
                      ] as const
                    )
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={value === "hecho" || value === "SHOW" || value === "mostro" ? "primary" : "outline"}
                onClick={() =>
                  void onPatch(selected.id, value, selected.tipo === "AGENDA_CHECK")
                }
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComisionesSheet({
  rows,
  resumen,
  money,
  onPaid,
  empty = "Todavía no hay cash cobrado en llamadas.",
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
          { key: "fecha", label: "Fecha", width: 90, value: (row) => row.fecha.slice(0, 10) },
          { key: "cliente", label: "Cliente", width: 160, value: (row) => row.cliente },
          { key: "oferta", label: "Oferta", width: 140, value: (row) => row.oferta },
          { key: "venta", label: "Venta", width: 90, align: "right", value: (row) => money(row.venta) },
          { key: "cash", label: "Cash", width: 90, align: "right", value: (row) => money(row.cash) },
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
