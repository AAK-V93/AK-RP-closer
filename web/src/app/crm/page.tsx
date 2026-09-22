"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";
import { ProjectionCard } from "@/components/projection-card";
import { SheetTable, sheetCell, type SheetColumn } from "@/components/crm-sheet";
import type { OperacionRow } from "@/lib/crm-operacion";
import { moneyLabel, pctLabel } from "@/lib/crm-operacion";
import type { CommissionProjection } from "@/lib/crm-projection";

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
    etapaPerdida: { etapa: string; count: number }[];
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

  const operacion = useMemo(
    () => (data?.operacion || []).filter((row) => matchesOffer(row.oferta || row.producto, offer)),
    [data?.operacion, offer],
  );
  const followups = useMemo(
    () => (data?.followups || []).filter((row) => matchesOffer(row.oferta || "", offer)),
    [data?.followups, offer],
  );
  const commissions = useMemo(
    () => (data?.commissions || []).filter((row) => matchesOffer(row.oferta || "", offer)),
    [data?.commissions, offer],
  );

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

            {module === "ahora" && (
              <AhoraSheet
                now={now}
                money={money}
                projection={data.projection || null}
                needsGoal={data.needsMonthlyGoal}
                saving={savingGoal}
                onSaveGoal={saveGoal}
                currency={currency}
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
              />
            )}
            {module === "comisiones" && (
              <ComisionesSheet
                rows={commissions}
                resumen={data.comisionResumen}
                money={money}
                onPaid={markCommission}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
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
}: {
  now: Record<string, number>;
  money: (value: number | null | undefined) => string;
  projection: CommissionProjection | null;
  needsGoal?: boolean;
  saving: boolean;
  onSaveGoal: (usd: number) => Promise<void>;
  currency: string;
}) {
  const rows = [
    { id: "vencidos", metrica: "Seguimientos vencidos", valor: String(now.seguimientosVencidos || 0) },
    { id: "hoy", metrica: "Seguimientos de hoy", valor: String(now.seguimientosHoy || 0) },
    { id: "agendas-hoy", metrica: "Agendas de hoy", valor: String(now.agendasHoy || 0) },
    { id: "juego", metrica: "Dinero en juego", valor: money(now.dineroEnJuego) },
    { id: "cash", metrica: "Cash pendiente", valor: money(now.cashPendiente) },
    { id: "comision", metrica: "Comisión pendiente", valor: money(now.comisionPendiente) },
    { id: "oportunidades", metrica: "Oportunidades activas", valor: String(now.oportunidadesActivas || 0) },
    { id: "futuras", metrica: "Agendas futuras", valor: String(now.agendasFuturas || 0) },
  ];
  return (
    <div className="space-y-3">
      <ProjectionCard
        projection={projection}
        needsGoal={needsGoal}
        saving={saving}
        onSaveGoal={onSaveGoal}
        currency={currency}
      />
      <SheetTable
        columns={[
          { key: "metrica", label: "Métrica", width: 220, value: (row) => row.metrica },
          { key: "valor", label: "Valor", width: 160, align: "right", value: (row) => row.valor },
        ]}
        rows={rows}
        getId={(row) => row.id}
        empty="Sin métricas."
      />
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
}: {
  rows: OperacionRow[];
  money: (value: number | null | undefined) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selected: OperacionRow | null;
}) {
  const columns: SheetColumn<OperacionRow>[] = [
    { key: "fecha", label: "Fecha", width: 90, value: (row) => row.fecha },
    { key: "cliente", label: "Cliente", width: 160, value: (row) => row.cliente },
    { key: "tel", label: "Teléfono", width: 110, value: (row) => row.telefono },
    { key: "canal", label: "Canal", width: 80, value: (row) => row.canal },
    { key: "estado", label: "Estado", width: 100, value: (row) => row.estadoAgenda },
    { key: "prox", label: "Próx. seg.", width: 90, value: (row) => row.fechaProximo },
    { key: "producto", label: "Producto", width: 140, value: (row) => row.producto || row.oferta },
    { key: "venta", label: "Venta", width: 90, align: "right", value: (row) => money(row.venta) },
    { key: "modo", label: "Modo pago", width: 100, value: (row) => row.modoPago },
    { key: "cash", label: "Cash", width: 90, align: "right", value: (row) => money(row.cash) },
    { key: "req", label: "Req. seg.", width: 70, value: (row) => row.requiereSeguimiento },
    { key: "tipo", label: "Tipo seg.", width: 100, value: (row) => row.tipoSeguimiento },
    { key: "acuerdo", label: "Acuerdo", width: 140, value: (row) => row.acuerdo },
    { key: "cal", label: "Calificado", width: 80, value: (row) => row.calificado },
    { key: "razon", label: "Razón no cierre", width: 140, value: (row) => row.razonNoCierre },
    { key: "etapa", label: "Etapa pérdida", width: 100, value: (row) => row.etapaPerdida },
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
        empty="Aún no hay llamadas en esta oferta."
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
              ["Estado", selected.estadoAgenda],
              ["Próximo seguimiento", selected.fechaProximo],
              ["Producto", selected.producto || selected.oferta],
              ["Venta", money(selected.venta)],
              ["Modo de pago", selected.modoPago],
              ["Cash", money(selected.cash)],
              ["Saldo", money(selected.saldo)],
              ["Req. seguimiento", selected.requiereSeguimiento],
              ["Tipo", selected.tipoSeguimiento],
              ["Acuerdo", selected.acuerdo],
              ["Calificado", selected.calificado],
              ["Razón no cierre", selected.razonNoCierre],
              ["Etapa pérdida", selected.etapaPerdida],
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
  const funnel = data.desglose?.embudo;
  const kpis = [
    { id: "agendas", metrica: "Agendas del período", valor: String(mes?.agendas || 0) },
    { id: "shows", metrica: "Shows", valor: String(mes?.shows || 0) },
    { id: "close", metrica: "Close rate s/ shows", valor: pctLabel(mes?.closeRate) },
    { id: "cal", metrica: "Close rate calificado", valor: pctLabel(mes?.closeRateCalificado) },
    { id: "ticket", metrica: "Ticket promedio", valor: money(mes?.ticket) },
    { id: "ventas", metrica: "Ventas", valor: money(mes?.ventas) },
    { id: "cash", metrica: "Cash", valor: money(mes?.cash) },
    { id: "cashpct", metrica: "% cash cobrado", valor: pctLabel(mes?.cashPct) },
    { id: "cgen", metrica: "Comisión gen.", valor: money(data.comisionResumen?.generada) },
    { id: "ccob", metrica: "Comisión cobrada", valor: money(data.comisionResumen?.cobrada) },
    { id: "cpct", metrica: "% comisión cobrada", valor: pctLabel(data.comisionResumen?.pctCobrado) },
    { id: "pipe", metrica: "Pipeline 7 días", valor: String(data.now?.agendasFuturas || 0) },
  ];
  const funnelRows = [
    { id: "a", etapa: "Agendas", valor: String(funnel?.agendas || 0) },
    { id: "s", etapa: "Shows", valor: String(funnel?.shows || 0) },
    { id: "c", etapa: "Cierres", valor: String(funnel?.cierres || 0) },
  ];
  return (
    <div className="space-y-4">
      <SheetTable
        columns={[
          { key: "metrica", label: "Métrica", width: 220, value: (row) => row.metrica },
          { key: "valor", label: "Valor", width: 160, align: "right", value: (row) => row.valor },
        ]}
        rows={kpis}
        getId={(row) => row.id}
      />
      <SheetTable
        columns={[
          { key: "etapa", label: "Embudo", width: 140, value: (row) => row.etapa },
          { key: "valor", label: "Cantidad", width: 90, align: "right", value: (row) => row.valor },
        ]}
        rows={funnelRows}
        getId={(row) => row.id}
      />
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
      <div className="grid md:grid-cols-2 gap-4">
        <SheetTable
          columns={[
            { key: "razon", label: "Razón de no cierre", width: 220, value: (row) => row.razon },
            { key: "count", label: "N", width: 60, align: "right", value: (row) => row.count },
          ]}
          rows={data.desglose?.razonNoCierre || []}
          getId={(row) => `${row.razon}-${row.count}`}
          empty="Sin datos aún."
        />
        <SheetTable
          columns={[
            { key: "etapa", label: "Etapa pérdida", width: 220, value: (row) => row.etapa },
            { key: "count", label: "N", width: 60, align: "right", value: (row) => row.count },
          ]}
          rows={data.desglose?.etapaPerdida || []}
          getId={(row) => `${row.etapa}-${row.count}`}
          empty="Sin datos aún."
        />
      </div>
      <SheetTable
        columns={[
          { key: "mes", label: "Mes", width: 90, value: (row) => row.mes },
          { key: "agendas", label: "Agendas", width: 80, align: "right", value: (row) => row.agendas },
          { key: "shows", label: "Shows", width: 80, align: "right", value: (row) => row.shows },
          { key: "cierres", label: "Cierres", width: 80, align: "right", value: (row) => row.cierres },
          { key: "ventas", label: "Ventas", width: 110, align: "right", value: (row) => money(row.ventas) },
          { key: "cash", label: "Cash", width: 110, align: "right", value: (row) => money(row.cash) },
        ]}
        rows={data.evolucion || []}
        getId={(row) => row.mes}
        empty="Sin evolución aún."
      />
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
}: {
  rows: Followup[];
  money: (value: number | null | undefined) => string;
  selected: Followup | null;
  onSelect: (id: string) => void;
  onPick: (alertId: string, optionId: string) => Promise<void>;
  onPatch: (alertId: string, resultado: string, agenda?: boolean) => Promise<void>;
}) {
  return (
    <div className="space-y-2">
      <SheetTable
        columns={[
          { key: "temp", label: "Temperatura", width: 100, value: (row) => row.temperatura || "—" },
          { key: "estado", label: "Estado", width: 90, value: (row) => row.estado },
          { key: "cuando", label: "Cuándo", width: 90, value: (row) => row.dueAt.slice(0, 10) },
          { key: "dias", label: "Días", width: 60, align: "right", value: (row) => row.days },
          { key: "cliente", label: "Cliente", width: 160, value: (row) => row.cliente },
          { key: "tel", label: "Teléfono", width: 110, value: (row) => row.telefono },
          { key: "oferta", label: "Oferta", width: 140, value: (row) => row.oferta },
          { key: "tipo", label: "Tipo", width: 120, value: (row) => row.tipo },
          { key: "accion", label: "Qué hacer", width: 220, value: (row) => row.queHacer || row.acuerdo || row.question },
          { key: "juego", label: "En juego", width: 100, align: "right", value: (row) => (row.enJuego ? money(row.enJuego) : "—") },
          { key: "canal", label: "Canal", width: 80, value: (row) => row.canal },
        ]}
        rows={rows}
        getId={(row) => row.id}
        selectedId={selected?.id || null}
        onRowClick={(row) => onSelect(row.id)}
        empty="No hay seguimientos abiertos."
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
            {selected.tipo === "AGENDA_CHECK"
              ? (
                  [
                    ["SHOW", "Show"],
                    ["NO SHOW", "No show"],
                    ["REPROGRAMA", "Reprogramó"],
                  ] as const
                ).map(([estado, label]) => (
                  <Button
                    key={estado}
                    size="sm"
                    variant={estado === "SHOW" ? "primary" : "outline"}
                    onClick={() => void onPatch(selected.id, estado, true)}
                  >
                    {label}
                  </Button>
                ))
              : (
                  [
                    ["hecho", "Hecho"],
                    ["no_contesto", "No contestó"],
                    ["reprogramado", "Reprogramar"],
                    ["cerro", "Cerró"],
                    ["perdido", "Perdido"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={value === "hecho" ? "primary" : "outline"}
                    onClick={() => void onPatch(selected.id, value)}
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
}: {
  rows: Commission[];
  resumen?: Dash["comisionResumen"];
  money: (value: number | null | undefined) => string;
  onPaid: (id: string) => Promise<void>;
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
          { key: "estado", label: "Estado", width: 100, value: (row) => row.estado },
          { key: "fcobro", label: "Fecha cobro", width: 90, value: (row) => row.fechaCobro?.slice(0, 10) },
        ]}
        rows={rows}
        getId={(row) => row.id}
        selectedId={openId}
        onRowClick={(row) => setOpenId(openId === row.id ? null : row.id)}
        empty="Todavía no hay cash cobrado en llamadas."
      />
      {selected && selected.estado !== "COBRADA" && (
        <div className="border border-separator1 bg-bg1 p-3">
          <Button size="sm" variant="outline" onClick={() => void onPaid(selected.id)}>
            Marcar cobrada
          </Button>
        </div>
      )}
    </div>
  );
}
