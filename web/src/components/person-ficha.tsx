"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { invalidateHub } from "@/lib/hub-client";
import { initialsOf } from "@/lib/inicio-view";
import type { PersonFacts } from "@/lib/person-facts";
import { fichaDetailRows, fichaUrl, type FichaTarget } from "@/lib/ficha-target";
import { whatsappClickHref } from "@/lib/whatsapp-link";
import { lostSuggestion } from "@/lib/followup-stage";
import type { RecordingInfo } from "@/lib/recording-ficha";
import { ADD_TO_CRM_TITLE, addToCrmProposal, addToCrmResult, NOT_IN_CRM_NOTE, RECORDING_EMPTY_VALUE } from "@/lib/recording-ficha-copy";

export type { FichaTarget } from "@/lib/ficha-target";

type Ficha = PersonFacts & { personId: string; next: string; inCrm?: boolean; recording?: RecordingInfo };

const DARK_BUTTON =
  "inline-flex h-11 min-h-11 items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] bg-fg0 px-3.5 text-[15px] font-medium text-[#FBF8F2] transition-opacity hover:opacity-90 disabled:opacity-60 lg:h-9 lg:min-h-0 lg:rounded-[9px] lg:px-3 lg:text-[13px]";
const LINE_BUTTON =
  "inline-flex h-11 min-h-11 items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] border border-separator2 bg-transparent px-3.5 text-[15px] font-medium text-fg0 transition-colors hover:bg-bg2 disabled:opacity-60 lg:h-9 lg:min-h-0 lg:rounded-[9px] lg:px-3 lg:text-[13px]";

/** A name you can tap: link color, underline on hover, and a chevron. Same at 1280 and 375. */
export function PersonNameButton({
  name,
  onOpen,
  className = "",
}: {
  name: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      aria-label={`Abrir la ficha de ${name}`}
      className={`group inline-flex min-h-11 max-w-full cursor-pointer items-center gap-1 text-left font-semibold text-fg0 underline decoration-separator2 decoration-1 underline-offset-4 transition-colors hover:decoration-fg0 focus-visible:decoration-fg0 lg:min-h-0 ${className}`}
    >
      <span className="min-w-0 whitespace-normal break-words">{name}</span>
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg0" />
    </button>
  );
}

function WhatsAppGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366" />
      <path
        d="M8.5 7.5c.3-.3.8-.3 1 .1l1 1.8c.2.3.1.7-.1 1l-.6.6c.6 1.3 1.6 2.3 2.9 2.9l.6-.6c.3-.3.7-.3 1-.1l1.8 1c.4.2.4.7.1 1-.9.9-2 1.2-3.2.7-2.3-1-4.1-2.8-5.1-5.1-.5-1.2-.2-2.3.6-3.3z"
        fill="#fff"
      />
    </svg>
  );
}

async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copié el mensaje", duration: 2000 });
  } catch {
    toast({ title: "No pude copiarlo. Selecciónalo y cópialo a mano.", variant: "destructive", duration: 3000 });
  }
}

function AddPhone({
  leadId,
  callId,
  name,
  onSaved,
}: {
  leadId: string;
  callId: string;
  name: string;
  onSaved: (phone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Nowhere to save it (the call never reached the CRM): say nothing about a phone we can't add.
  if (!leadId && !callId) return null;
  if (!open) {
    return (
      <button type="button" className={LINE_BUTTON} onClick={() => setOpen(true)}>
        Agregar teléfono
      </button>
    );
  }
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-phone", leadId: leadId || undefined, callId: leadId ? undefined : callId, telefono: draft }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; telefono?: string };
      if (!response.ok) throw new Error(body.error || "No se guardó. Inténtalo otra vez.");
      toast({ title: `Guardé el teléfono de ${name}`, duration: 2500 });
      invalidateHub();
      onSaved(body.telefono || draft);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se guardó. Inténtalo otra vez.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-2">
      <label htmlFor="ficha-telefono" className="block text-[13px] text-fg2">
        Teléfono de {name}, con código de país
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="ficha-telefono"
          inputMode="tel"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="+57 300 123 4567"
          className="w-48 min-w-0"
        />
        <button type="submit" disabled={saving || !draft.trim()} className={DARK_BUTTON}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={LINE_BUTTON}>
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

/**
 * THE ficha. Inicio, CRM (every tab) and Llamadas open this same sheet.
 * It loads the person from /api/crm/ficha and shows what Inicio passed while it loads.
 */
export function PersonFicha({
  target,
  onClose,
  onDone,
  busy = false,
}: {
  target: FichaTarget | null;
  onClose: () => void;
  /** Inicio and CRM «Hecho». Hidden when the surface has no open follow-up to close. */
  onDone?: (alertId: string) => void;
  busy?: boolean;
}) {
  const mobile = useIsMobile();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [picked, setPicked] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [phone, setPhone] = useState("");
  const [reload, setReload] = useState(0);
  const key = target ? fichaUrl(target) : "";

  useEffect(() => {
    setFicha(null);
    setError("");
    setShowAll(false);
    setPicked(0);
    setDrafts(target?.initial?.messages || []);
    setPhone(target?.initial?.phone || "");
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    fetch(key)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { ficha?: Ficha; error?: string };
        if (cancelled) return;
        if (!response.ok || !body.ficha) {
          setError(body.error || "No pude abrir la ficha.");
          return;
        }
        setFicha(body.ficha);
        // The ficha decides: a Perdido has no messages even if Inicio had some.
        setDrafts(body.ficha.messages);
        setPicked(0);
        if (body.ficha.phone) setPhone(body.ficha.phone);
      })
      .catch(() => {
        if (!cancelled) setError("No pude abrir la ficha.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The url carries the whole target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reload]);

  if (!target) return null;
  const name = ficha?.name || target.name;
  const offer = ficha?.offer || target.initial?.offer || "";
  const summary = ficha ? ficha.summary.text : target.initial?.summary || "";
  const next = ficha ? (ficha.ended ? "" : ficha.next) : target.initial?.when || "";
  const stage = ficha ? ficha.stage?.label || "" : "";
  const alertId = target.alertId || ficha?.openAlertId || "";
  const chosen = (drafts[picked] || drafts.find((item) => item.trim()) || "").trim();
  const rows = ficha ? fichaDetailRows(ficha) : [];

  return (
    <Sheet open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={
          mobile
            ? "max-h-[92vh] overflow-y-auto rounded-t-2xl border-separator1 bg-bg0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "w-full overflow-y-auto border-separator1 bg-bg0 px-4 py-5 sm:max-w-md"
        }
      >
        <div data-ficha className="flex items-start gap-3 pr-10">
          <div aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-bg2 text-sm font-semibold text-fg2">
            {initialsOf(name)}
          </div>
          <div className="min-w-0">
            <SheetTitle className="text-left font-display text-xl leading-tight text-fg0">{name}</SheetTitle>
            <SheetDescription className="text-left text-[13px] text-fg3">
              {[offer, ficha?.status && ficha.status !== "En seguimiento" ? ficha.status : "", stage].filter(Boolean).join(" · ") ||
                (loading ? "Cargando…" : "")}
            </SheetDescription>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {ficha && ficha.inCrm === false && (
          <p className="rounded-xl border border-separator1 bg-bg1 px-3 py-2 text-[13px] text-fg2">
            {ficha.recording?.note || NOT_IN_CRM_NOTE}
          </p>
        )}
        {ficha && ficha.inCrm === false && ficha.recording?.canAdd && (
          <AddToCrmCard key={ficha.recording.id} name={name} recording={ficha.recording} onAdded={() => setReload((value) => value + 1)} />
        )}

        <section aria-label="En qué quedaron" className="rounded-2xl border border-[#EBD3A8] bg-[#F6E7CC] px-3.5 py-3 text-[14px] leading-snug text-[#5E3B0B]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7A4C0E]">En qué quedaron</p>
          <p className="mt-1 text-fg0">{summary || (loading ? "Cargando…" : "No quedó claro el siguiente paso.")}</p>
          {(next || stage) && (
            <p className="mt-2 border-t border-[#EBD3A8] pt-2 text-[13px]">
              {[stage, next].filter(Boolean).join(" · ")}
            </p>
          )}
        </section>

        {ficha && !ficha.ended && alertId && (
          <LostSuggestion
            key={alertId}
            alertId={alertId}
            stage={ficha.stage}
            firstName={name.split(/\s+/)[0] || ""}
            onSaved={onClose}
          />
        )}

        {drafts.length > 0 && (
          <section aria-label="Mensajes sugeridos" className="space-y-2">
            <p className="text-xs font-medium text-fg3">Mensajes sugeridos (puedes editarlos)</p>
            <ul className="space-y-2">
              {drafts.map((text, index) => (
                <li key={`m-${index}`} className={`rounded-2xl border bg-bg1 p-3 ${picked === index ? "border-fg0" : "border-separator1"}`}>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="ficha-mensaje" className="mt-1" checked={picked === index} onChange={() => setPicked(index)} />
                    <textarea
                      value={text}
                      rows={3}
                      aria-label={`Mensaje ${index + 1}`}
                      onChange={(event) => {
                        const nextDrafts = [...drafts];
                        nextDrafts[index] = event.target.value;
                        setDrafts(nextDrafts);
                        setPicked(index);
                      }}
                      className="min-h-[4.5rem] w-full min-w-0 flex-1 resize-y bg-transparent text-[14px] leading-snug text-fg0 outline-none"
                    />
                  </label>
                  <div className="mt-2 flex justify-end">
                    <button type="button" className={LINE_BUTTON} onClick={() => void copyMessage(text)}>
                      Copiar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Contacto" className="space-y-2">
          {phone ? (
            <a href={whatsappClickHref(phone, chosen)} target="_blank" rel="noreferrer" className={`${DARK_BUTTON} w-full sm:w-auto`}>
              <WhatsAppGlyph />
              Abrir WhatsApp{chosen ? " con el mensaje" : ""}
            </a>
          ) : (
            <AddPhone
              leadId={ficha?.leadId || target.leadId || ""}
              callId={ficha?.callId || ""}
              name={name}
              onSaved={setPhone}
            />
          )}
        </section>

        {ficha && (
          <section className="rounded-2xl border border-separator1 bg-bg1">
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((value) => !value)}
              className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] font-medium text-fg0"
            >
              Ver todo lo de la llamada
              <ChevronDown aria-hidden className={`h-4 w-4 transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
            {showAll && (
              <div className="space-y-3 border-t border-separator1 px-3 py-3 text-[14px]">
                <dl className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.label}>
                      <dt className="text-[12px] font-medium text-fg3">{row.label}</dt>
                      {row.values.length > 1 ? (
                        <dd>
                          <ul className="list-disc space-y-1 pl-5 text-fg0">
                            {row.values.map((value) => (
                              <li key={value}>{value}</li>
                            ))}
                          </ul>
                        </dd>
                      ) : (
                        <dd className={row.values[0] ? "text-fg0" : "text-fg3"}>{row.values[0] || (ficha.recording ? RECORDING_EMPTY_VALUE : "No quedó anotado")}</dd>
                      )}
                    </div>
                  ))}
                </dl>
                <div>
                  <p className="text-[12px] font-medium text-fg3">Historial</p>
                  {ficha.history.length ? (
                    <ul className="mt-1 space-y-1">
                      {ficha.history.map((item, index) => (
                        <li key={`${item.day}-${index}`} className="flex gap-3 text-fg0">
                          <span className="w-16 shrink-0 text-fg3">{item.date}</span>
                          <span>{item.label}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-fg3">Todavía no hay llamadas ni seguimientos con fecha.</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        <div className="mt-auto flex flex-wrap justify-end gap-2">
          {onDone && alertId && !ficha?.ended && (
            <button type="button" disabled={busy} onClick={() => onDone(alertId)} className={LINE_BUTTON}>
              <Check aria-hidden className="h-4 w-4" strokeWidth={2.2} />
              Hecho
            </button>
          )}
          <button type="button" onClick={onClose} className={LINE_BUTTON}>
            Cerrar
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Proposed change at 10 tries: nothing changes until the closer taps «Guardar». */
function LostSuggestion({
  alertId,
  stage,
  firstName,
  onSaved,
}: {
  alertId: string;
  stage: { count: number; target: number } | null;
  firstName: string;
  onSaved: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const proposal = lostSuggestion(stage, firstName);
  if (!proposal || dismissed) return null;
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId, action: "outcome", resultado: "perdido", nota: proposal.nota }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se guardó. Inténtalo otra vez.");
      toast({ title: `${firstName || "La persona"} pasó a Perdidos`, duration: 2500 });
      invalidateHub();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se guardó. Inténtalo otra vez.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="Cambio propuesto" data-lost-suggestion className="space-y-2 rounded-2xl border border-separator1 bg-bg1 p-3 text-[14px]">
      <p className="text-fg0">{proposal.question}</p>
      <p className="text-[13px] text-fg3">Cambio propuesto: {proposal.change}. No cambia nada hasta que toques «Guardar».</p>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className={DARK_BUTTON}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" disabled={saving} onClick={() => setDismissed(true)} className={LINE_BUTTON}>
          No, sigo
        </button>
      </div>
    </section>
  );
}

/** «Agregar al CRM» as a proposed change: nothing is saved until «Guardar». */
function AddToCrmCard({ name, recording, onAdded }: { name: string; recording: RecordingInfo; onAdded: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (dismissed) return null;
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/crm/ficha/agregar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: recording.id, kind: recording.kind }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; filingStatus?: string; question?: string; already?: boolean };
      if (!response.ok) {
        setError(body.error || "No pude agregarla. Inténtalo otra vez.");
        return;
      }
      toast({ title: addToCrmResult(name, body) });
      invalidateHub();
      setDismissed(true);
      onAdded();
    } catch {
      setError("No pude agregarla. Inténtalo otra vez.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label={ADD_TO_CRM_TITLE} className="rounded-2xl border border-separator2 bg-bg1 px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-fg3">Cambio propuesto</p>
      <p className="mt-1 text-[14px] text-fg0">{addToCrmProposal(name)}</p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={saving} onClick={() => void save()} className={DARK_BUTTON}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" disabled={saving} onClick={() => setDismissed(true)} className={LINE_BUTTON}>
          No
        </button>
      </div>
    </section>
  );
}
