"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { FollowupPicker, type FollowupOptionView } from "@/components/followup-picker";

type Followup = {
  id: string;
  question: string;
  dueAt: string;
  type: string;
  leadName?: string;
  overdue?: boolean;
  estado?: string;
  mensajeSugerido?: string;
  enJuego?: number;
  canal?: string;
  telefono?: string;
  oferta?: string;
  contexto?: string;
  opciones?: FollowupOptionView[];
  selectedId?: string;
};

export default function CrmPage() {
  const { status } = useSession();
  const [data, setData] = useState<{
    readyCrm?: boolean;
    missingCrm?: { question: string } | null;
    now?: Record<string, number>;
    rendimiento?: { mes: { cierres: number; showRate: number; closeRate: number; ventas: number; cash: number } };
    followups?: Followup[];
    commissions?: { id: string; oferta: string; generada: number; cobrada: number; estado: string }[];
    comisionResumen?: { generada: number; cobrada: number; pendiente: number };
    leads?: { id: string; name: string; company: string; offerName: string; status: string; lastSummary: string; nextStep: string }[];
    desglose?: { razonNoCierre: { razon: string; count: number }[]; etapaPerdida: { etapa: string; count: number }[] };
    alerts?: Followup[];
  } | null>(null);

  const load = () =>
    fetch("/api/crm")
      .then((r) => r.json())
      .then(setData)
      .catch(() => undefined);

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
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

  const now = data?.now || {};
  const alerts = data?.alerts || data?.followups || [];
  const leads = data?.leads || [];

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-light">CRM</h1>
          <p className="text-sm text-fg3">
            Lectura. Se escribe en el chat de inicio o con los botones de cada alerta.
          </p>
        </div>
        {status !== "authenticated" ? (
          <Button asChild variant="primary">
            <Link href="/login?callbackUrl=/crm">Entrar</Link>
          </Button>
        ) : !data?.readyCrm ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-2">
            <p className="text-sm">
              {data?.missingCrm?.question ||
                "Para registrar ventas y comisiones necesito los detalles de tu oferta. ¿Tienes un PDF o me los cuentas?"}
            </p>
            <Button asChild variant="primary" size="sm">
              <Link href="/">Contarlo en el chat</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Metric label="Vencidos" value={String(now.seguimientosVencidos || 0)} />
              <Metric label="Hoy" value={String(now.seguimientosHoy || 0)} />
              <Metric label="En juego" value={`USD ${Math.round(now.dineroEnJuego || 0)}`} />
              <Metric label="Comisión pend." value={`USD ${Math.round(now.comisionPendiente || 0)}`} />
              <Metric label="Cash pend." value={`USD ${Math.round(now.cashPendiente || 0)}`} />
              <Metric label="Agendas hoy" value={String(now.agendasHoy || 0)} />
              <Metric label="Cierres mes" value={String(data.rendimiento?.mes.cierres || 0)} />
              <Metric
                label="Close rate"
                value={`${Math.round((data.rendimiento?.mes.closeRate || 0) * 100)}%`}
              />
            </div>
            {alerts.length > 0 && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <p className="text-sm font-medium">Cola de seguimiento</p>
                {alerts.slice(0, 12).map((alert) => (
                  <div key={alert.id} className="space-y-2 border-b border-separator1 pb-3 last:border-0">
                    <div className="flex justify-between gap-2">
                      <p className="text-sm">
                        <span className="text-[11px] text-fg3 mr-2">{alert.estado || ""}</span>
                        {alert.leadName} · {alert.type || alert.oferta}
                      </p>
                      {alert.enJuego ? (
                        <span className="text-xs">USD {alert.enJuego}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-fg2">{alert.question}</p>
                    {alert.contexto && (
                      <p className="text-[11px] text-fg3">{alert.contexto.split("\n")[0]}</p>
                    )}
                    {alert.type !== "AGENDA_CHECK" && (alert.opciones || []).length > 0 ? (
                      <FollowupPicker
                        alertId={alert.id}
                        options={alert.opciones || []}
                        selectedId={alert.selectedId}
                        phone={alert.telefono}
                        onChoose={pickScript}
                      />
                    ) : (
                      alert.mensajeSugerido && (
                        <p className="text-xs text-fg3 whitespace-pre-wrap">{alert.mensajeSugerido}</p>
                      )
                    )}
                    <div className="flex flex-wrap gap-1">
                      {alert.type === "AGENDA_CHECK"
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
                              onClick={() => void patch(alert.id, estado, true)}
                            >
                              {label}
                            </Button>
                          ))
                        : (["hecho", "no_contesto", "reprogramado", "cerro", "perdido"] as const).map(
                            (resultado) => (
                              <Button
                                key={resultado}
                                size="sm"
                                variant={resultado === "hecho" ? "primary" : "outline"}
                                onClick={() => void patch(alert.id, resultado)}
                              >
                                {resultado === "hecho"
                                  ? "Hecho"
                                  : resultado === "no_contesto"
                                    ? "No contestó"
                                    : resultado === "reprogramado"
                                      ? "Reprogramar"
                                      : resultado === "cerro"
                                        ? "Cerró"
                                        : "Perdido"}
                              </Button>
                            ),
                          )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {data.comisionResumen && (
              <div className="rounded-2xl border border-separator1 bg-bg1 p-4 space-y-2">
                <p className="text-sm font-medium">Comisiones</p>
                <p className="text-xs text-fg3">
                  Generada USD {Math.round(data.comisionResumen.generada)} · cobrada{" "}
                  {Math.round(data.comisionResumen.cobrada)} · pendiente{" "}
                  {Math.round(data.comisionResumen.pendiente)}
                </p>
                {(data.commissions || []).slice(0, 8).map((row) => (
                  <p key={row.id} className="text-xs text-fg2">
                    {row.oferta} · {row.estado} · gen {Math.round(row.generada)} / cob{" "}
                    {Math.round(row.cobrada)}
                  </p>
                ))}
                <p className="text-[11px] text-fg3">
                  “Me pagaron la comisión de Alberto” se registra en el chat de inicio.
                </p>
              </div>
            )}
            <div className="space-y-2">
              {leads.map((lead) => (
                <div
                  key={lead.id}
                  className="rounded-xl border border-separator1 bg-bg1 px-3 py-2 space-y-1"
                >
                  <div className="flex justify-between gap-2">
                    <p className="text-sm font-medium">
                      {lead.name}
                      {lead.company ? ` · ${lead.company}` : ""}
                    </p>
                    <span className="text-xs text-fg3">{lead.status}</span>
                  </div>
                  <p className="text-xs text-fg3">
                    {[lead.offerName, lead.nextStep].filter(Boolean).join(" · ")}
                  </p>
                  {lead.lastSummary && (
                    <p className="text-xs text-fg2">{lead.lastSummary}</p>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/practicar?focus=${encodeURIComponent(lead.name)}`}>
                      Practicar este lead
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
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
