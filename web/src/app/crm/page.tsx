"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";
import type { OperacionRow } from "@/lib/crm-operacion";
import { moneyLabel, pctLabel } from "@/lib/crm-operacion";

type ModuleId = "operacion" | "dashboard" | "seguimientos" | "comisiones";

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
  evolucion?: { mes: string; agendas: number; shows: number; cierres: number; ventas: number; cash: number }[];
  offers?: { id: string; productName: string; currency: string }[];
  operacion?: OperacionRow[];
};

const MODULES: { id: ModuleId; label: string }[] = [
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

  const load = () =>
    fetch("/api/crm")
      .then((r) => r.json())
      .then(setData)
      .catch(() => undefined);

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

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-fg3">Centro de control comercial</p>
          <h1 className="text-2xl font-light">CRM</h1>
          <p className="text-sm text-fg3">
            Misma lógica que la hoja de operación: una fila por llamada, cola de
            seguimiento y comisiones que nacen cuando hay cash cobrado. Las ofertas
            son las tuyas, no un producto fijo.
          </p>
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

            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">
                Ahora mismo
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Metric label="Seguimientos vencidos" value={String(now.seguimientosVencidos || 0)} />
                <Metric label="Seguimientos de hoy" value={String(now.seguimientosHoy || 0)} />
                <Metric label="Agendas de hoy" value={String(now.agendasHoy || 0)} />
                <Metric label="Dinero en juego" value={money(now.dineroEnJuego)} />
                <Metric label="Cash pendiente" value={money(now.cashPendiente)} />
                <Metric label="Comisión pendiente" value={money(now.comisionPendiente)} />
                <Metric label="Oportunidades activas" value={String(now.oportunidadesActivas || 0)} />
                <Metric label="Agendas futuras" value={String(now.agendasFuturas || 0)} />
              </div>
            </section>

            {rendimiento && (
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">
                  Período
                </p>
                {offer !== "todas" && (
                  <p className="text-[11px] text-fg3">
                    Estas tasas son de todas las ofertas. Operación, seguimientos y
                    comisiones sí están filtradas a {offer}.
                  </p>
                )}
                <div className="overflow-x-auto rounded-xl border border-separator1 bg-bg1">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead>Mes en curso</TableHead>
                        <TableHead>Mes anterior</TableHead>
                        <TableHead>Acumulado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(
                        [
                          ["Agendas", (p) => String(p.agendas)],
                          ["Shows", (p) => String(p.shows)],
                          ["No shows", (p) => String(p.noShows)],
                          ["Cierres", (p) => String(p.cierres)],
                          ["Show rate", (p) => pctLabel(p.showRate)],
                          ["Close rate", (p) => pctLabel(p.closeRate)],
                          ["Ventas", (p) => money(p.ventas)],
                          ["Cash", (p) => money(p.cash)],
                        ] as [string, (p: Period) => string][]
                      ).map(([label, read]) => (
                        <TableRow key={label}>
                          <TableCell className="text-xs text-fg3">{label}</TableCell>
                          <TableCell>{read(rendimiento.mes)}</TableCell>
                          <TableCell>{read(rendimiento.anterior)}</TableCell>
                          <TableCell>{read(rendimiento.acumulado)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
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

            <div className="flex flex-wrap gap-2">
              {MODULES.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={module === item.id ? "primary" : "outline"}
                  onClick={() => setModule(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>

            {module === "operacion" && (
              <OperacionTable rows={operacion} money={money} />
            )}
            {module === "dashboard" && (
              <DashboardBlock data={data} money={money} />
            )}
            {module === "seguimientos" && (
              <SeguimientosTable
                rows={followups}
                money={money}
                openId={openAlert}
                onOpen={setOpenAlert}
                onPick={pickScript}
                onPatch={patch}
              />
            )}
            {module === "comisiones" && (
              <ComisionesTable
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-separator1 bg-bg1 p-3">
      <p className="text-[11px] uppercase tracking-wide text-fg3">{label}</p>
      <p className="text-lg font-light">{value}</p>
    </div>
  );
}

function OperacionTable({
  rows,
  money,
}: {
  rows: OperacionRow[];
  money: (value: number | null | undefined) => string;
}) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">Operación comercial</p>
      <p className="text-[11px] text-fg3">
        Una fila por reunión. El extractor llena esto; no se edita a mano aquí.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-fg3">Aún no hay llamadas en esta oferta.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-separator1 bg-bg1">
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "Fecha",
                  "Cliente",
                  "Teléfono",
                  "Canal",
                  "Estado agenda",
                  "Próx. seg.",
                  "Producto",
                  "Venta",
                  "Modo pago",
                  "Cash",
                  "Req. seg.",
                  "Tipo seg.",
                  "Acuerdo",
                  "Calificado",
                  "Razón no cierre",
                  "Etapa pérdida",
                  "Notas",
                ].map((label) => (
                  <TableHead key={label} className="whitespace-nowrap">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.fecha || "—"}</TableCell>
                  <TableCell className="font-medium text-fg1">{row.cliente || "—"}</TableCell>
                  <TableCell>{row.telefono || "—"}</TableCell>
                  <TableCell>{row.canal || "—"}</TableCell>
                  <TableCell>{row.estadoAgenda || "—"}</TableCell>
                  <TableCell>{row.fechaProximo || "—"}</TableCell>
                  <TableCell>{row.producto || row.oferta || "—"}</TableCell>
                  <TableCell>{money(row.venta)}</TableCell>
                  <TableCell>{row.modoPago || "—"}</TableCell>
                  <TableCell>{money(row.cash)}</TableCell>
                  <TableCell>{row.requiereSeguimiento || "—"}</TableCell>
                  <TableCell>{row.tipoSeguimiento || "—"}</TableCell>
                  <TableCell className="max-w-[220px] whitespace-normal text-xs">
                    {row.acuerdo || "—"}
                  </TableCell>
                  <TableCell>{row.calificado || "—"}</TableCell>
                  <TableCell className="max-w-[180px] whitespace-normal text-xs">
                    {row.razonNoCierre || "—"}
                  </TableCell>
                  <TableCell>{row.etapaPerdida || "—"}</TableCell>
                  <TableCell className="max-w-[240px] whitespace-normal text-xs">
                    {row.notas || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function DashboardBlock({
  data,
  money,
}: {
  data: Dash;
  money: (value: number | null | undefined) => string;
}) {
  const mes = data.rendimiento?.mes;
  const funnel = data.desglose?.embudo;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Agendas del período" value={String(mes?.agendas || 0)} />
        <Metric label="Shows" value={String(mes?.shows || 0)} />
        <Metric label="Close rate s/ shows" value={pctLabel(mes?.closeRate)} />
        <Metric label="Close rate calificado" value={pctLabel(mes?.closeRateCalificado)} />
        <Metric label="Ticket promedio" value={money(mes?.ticket)} />
        <Metric label="Ventas" value={money(mes?.ventas)} />
        <Metric label="Cash" value={money(mes?.cash)} />
        <Metric label="% cash cobrado" value={pctLabel(mes?.cashPct)} />
        <Metric label="Comisión gen." value={money(data.comisionResumen?.generada)} />
        <Metric label="Comisión cobrada" value={money(data.comisionResumen?.cobrada)} />
        <Metric label="% comisión cobrada" value={pctLabel(data.comisionResumen?.pctCobrado)} />
        <Metric label="Pipeline 7 días" value={String(data.now?.agendasFuturas || 0)} />
      </div>
      <section className="space-y-2">
        <p className="text-sm font-medium">Embudo de la llamada</p>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Agendas" value={String(funnel?.agendas || 0)} />
          <Metric label="Shows" value={String(funnel?.shows || 0)} />
          <Metric label="Cierres" value={String(funnel?.cierres || 0)} />
        </div>
      </section>
      {(data.desglose?.porOferta || []).length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-medium">Desglose por oferta</p>
          <div className="overflow-x-auto rounded-xl border border-separator1 bg-bg1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Oferta</TableHead>
                  <TableHead>Cierres</TableHead>
                  <TableHead>Ventas</TableHead>
                  <TableHead>Cash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.desglose?.porOferta.map((row) => (
                  <TableRow key={row.oferta}>
                    <TableCell>{row.oferta}</TableCell>
                    <TableCell>{row.cierres}</TableCell>
                    <TableCell>{money(row.ventas)}</TableCell>
                    <TableCell>{money(row.cash)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <CountList title="Razón de no cierre" rows={data.desglose?.razonNoCierre || []} keyName="razon" />
        <CountList title="Etapa pérdida" rows={data.desglose?.etapaPerdida || []} keyName="etapa" />
      </div>
      {(data.evolucion || []).length > 0 && (
        <section className="space-y-2">
          <p className="text-sm font-medium">Evolución · últimos 6 meses</p>
          <div className="overflow-x-auto rounded-xl border border-separator1 bg-bg1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead>Agendas</TableHead>
                  <TableHead>Shows</TableHead>
                  <TableHead>Cierres</TableHead>
                  <TableHead>Ventas</TableHead>
                  <TableHead>Cash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.evolucion || []).map((row) => (
                  <TableRow key={row.mes}>
                    <TableCell>{row.mes}</TableCell>
                    <TableCell>{row.agendas}</TableCell>
                    <TableCell>{row.shows}</TableCell>
                    <TableCell>{row.cierres}</TableCell>
                    <TableCell>{money(row.ventas)}</TableCell>
                    <TableCell>{money(row.cash)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}

function CountList({
  title,
  rows,
  keyName,
}: {
  title: string;
  rows: { count: number; razon?: string; etapa?: string }[];
  keyName: "razon" | "etapa";
}) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="rounded-xl border border-separator1 bg-bg1 p-3 space-y-1">
        {rows.length === 0 ? (
          <p className="text-xs text-fg3">Sin datos aún.</p>
        ) : (
          rows.map((row) => (
            <p key={`${row[keyName]}-${row.count}`} className="flex justify-between text-sm">
              <span>{row[keyName]}</span>
              <span className="text-fg3">{row.count}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}

function SeguimientosTable({
  rows,
  money,
  openId,
  onOpen,
  onPick,
  onPatch,
}: {
  rows: Followup[];
  money: (value: number | null | undefined) => string;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onPick: (alertId: string, optionId: string) => Promise<void>;
  onPatch: (alertId: string, resultado: string, agenda?: boolean) => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">Cola de seguimiento</p>
      <p className="text-[11px] text-fg3">
        Ordenada por fecha. Elige un guion, ábrelo en WhatsApp y marca el resultado.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-fg3">No hay seguimientos abiertos.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-separator1 bg-bg1">
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "Estado",
                  "Cuándo",
                  "Días",
                  "Cliente",
                  "Teléfono",
                  "Oferta",
                  "Tipo",
                  "Próxima acción",
                  "En juego",
                  "Canal",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => onOpen(openId === row.id ? null : row.id)}
                  >
                    <TableCell className={row.estado === "VENCIDO" ? "text-fgSerious1" : ""}>
                      {row.estado}
                    </TableCell>
                    <TableCell>{row.dueAt.slice(0, 10)}</TableCell>
                    <TableCell>{row.days}</TableCell>
                    <TableCell className="font-medium text-fg1">{row.cliente}</TableCell>
                    <TableCell>{row.telefono || "—"}</TableCell>
                    <TableCell>{row.oferta || "—"}</TableCell>
                    <TableCell>{row.tipo}</TableCell>
                    <TableCell className="max-w-[240px] whitespace-normal text-xs">
                      {row.acuerdo || row.question}
                    </TableCell>
                    <TableCell>{row.enJuego ? money(row.enJuego) : "—"}</TableCell>
                    <TableCell>{row.canal || "—"}</TableCell>
                  </TableRow>
                  {openId === row.id && (
                    <TableRow>
                      <TableCell colSpan={10} className="bg-bg2 whitespace-normal">
                        <div className="space-y-3 py-2">
                          {row.contexto && (
                            <p className="text-xs text-fg3">{row.contexto}</p>
                          )}
                          {row.tipo !== "AGENDA_CHECK" && (row.opciones || []).length > 0 ? (
                            <FollowupPicker
                              alertId={row.id}
                              options={row.opciones || []}
                              selectedId={row.selectedId}
                              phone={row.telefono}
                              onChoose={onPick}
                            />
                          ) : (
                            row.mensajeSugerido && (
                              <p className="text-xs whitespace-pre-wrap">{row.mensajeSugerido}</p>
                            )
                          )}
                          <div className="flex flex-wrap gap-1">
                            {row.tipo === "AGENDA_CHECK"
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
                                    onClick={() => void onPatch(row.id, estado, true)}
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
                                    onClick={() => void onPatch(row.id, value)}
                                  >
                                    {label}
                                  </Button>
                                ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function ComisionesTable({
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
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">Módulo de comisiones</p>
      <p className="text-[11px] text-fg3">
        Entra sola cualquier fila con cash cobrado. Aquí marcas si ya te la pagaron.
      </p>
      {resumen && (
        <p className="text-sm">
          Generada {money(resumen.generada)} · cobrada {money(resumen.cobrada)} ·
          pendiente {money(resumen.pendiente)} ({pctLabel(resumen.pctCobrado)})
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-fg3">Todavía no hay cash cobrado en llamadas.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-separator1 bg-bg1">
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  "Fecha",
                  "Cliente",
                  "Oferta",
                  "Venta",
                  "Cash",
                  "%",
                  "Generada",
                  "Cobrada",
                  "Estado",
                  "Fecha cobro",
                  "",
                ].map((label) => (
                  <TableHead key={label || "accion"}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.fecha.slice(0, 10)}</TableCell>
                  <TableCell>{row.cliente || "—"}</TableCell>
                  <TableCell>{row.oferta || "—"}</TableCell>
                  <TableCell>{money(row.venta)}</TableCell>
                  <TableCell>{money(row.cash)}</TableCell>
                  <TableCell>{pctLabel(row.pct)}</TableCell>
                  <TableCell>{money(row.generada)}</TableCell>
                  <TableCell>{money(row.cobrada)}</TableCell>
                  <TableCell>{row.estado}</TableCell>
                  <TableCell>{row.fechaCobro?.slice(0, 10) || "—"}</TableCell>
                  <TableCell>
                    {row.estado !== "COBRADA" && (
                      <Button size="sm" variant="outline" onClick={() => void onPaid(row.id)}>
                        Marcar cobrada
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
