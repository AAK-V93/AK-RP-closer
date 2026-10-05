"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Pencil, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { moneyLabel } from "@/lib/crm-operacion";
import { invalidateHub } from "@/lib/hub-client";
import type { CommissionProjection } from "@/lib/crm-projection";
import { listSubtitle, sheetBlocks, type ChipTone, type InicioBlock, type InicioRow } from "@/lib/inicio-view";
import { whatsappClickHref } from "@/lib/whatsapp-link";

type PracticeCard = { practiceHref: string; drill: string; pattern: string };

const usd = (value: number) => moneyLabel(value, "USD");

/** Small ⓘ next to a title. The explanation lives here instead of a paragraph. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="relative ml-1.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-separator2 align-middle font-sans text-[10px] font-semibold not-italic leading-none text-fg3 after:absolute after:-inset-3 after:content-['']"
        >
          i
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] space-y-2 text-sm text-fg2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

const CHIP_TONE: Record<ChipTone, string> = {
  today: "bg-[#F6E7CC] text-[#7A4C0E]",
  late: "bg-[#F3DED6] text-[#9C4A3C]",
  future: "bg-bg2 text-fg2",
};

export function WhenChip({ tone, label }: { tone: ChipTone; label: string }) {
  return (
    <span
      data-tone={tone}
      className={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12.5px] font-medium leading-none ${CHIP_TONE[tone]}`}
    >
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
      <span className="truncate">{label}</span>
    </span>
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

const DARK_BUTTON =
  "inline-flex h-11 min-h-11 items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] bg-fg0 px-3.5 text-[15px] font-medium text-[#FBF8F2] transition-opacity hover:opacity-90 lg:h-8 lg:min-h-0 lg:rounded-[9px] lg:px-[11px] lg:text-[13px]";
const LINE_BUTTON =
  "inline-flex h-11 min-h-11 items-center justify-center gap-[7px] whitespace-nowrap rounded-[10px] border border-separator2 bg-transparent px-3.5 text-[15px] font-medium text-fg0 transition-colors hover:bg-bg2 lg:h-8 lg:min-h-0 lg:rounded-[9px] lg:px-[11px] lg:text-[13px]";

function GoalEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: number | null;
  onSave: (usd: number) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial ? String(initial) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(draft.replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount) || amount < 100) {
      setError("Pon un número (mínimo 100).");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(Math.round(amount));
    } catch {
      setError("No se guardó. Inténtalo otra vez.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-sm text-fg2" htmlFor="meta-usd">
        ¿Cuánto quieres ganar de comisión este mes? (USD)
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          id="meta-usd"
          inputMode="numeric"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ej. 3000"
          className="w-36 min-w-0"
        />
        <button type="submit" disabled={saving} className={DARK_BUTTON}>
          {saving ? "Guardando…" : "Guardar meta"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={LINE_BUTTON}>
            Cancelar
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

function GoalCard({
  inicio,
  projection,
  onSaveGoal,
}: {
  inicio: InicioBlock;
  projection: CommissionProjection | null;
  onSaveGoal: (usd: number) => Promise<void>;
}) {
  const { goal, paraLlegar, monthName } = inicio;
  const [editing, setEditing] = useState(false);
  const hasRoad = Boolean(paraLlegar.headline || paraLlegar.closeWhen);
  const roadTip = (
    <InfoTip label="Cómo se calcula «Para llegar»">
      <p>
        Es tu meta del mes menos la comisión que ya tienes asegurada: la que falta cobrarte y la de los
        saldos que tus clientes todavía deben.
      </p>
      <p>Los cierres salen de tu ticket y tu comisión. Las reuniones, de tu tasa de cierre real.</p>
      {projection?.assumedRatesLabel && <p>{projection.assumedRatesLabel} Por eso no te muestro reuniones.</p>}
    </InfoTip>
  );
  return (
    <section
      aria-label="Tu meta"
      className={`rounded-2xl border border-separator1 bg-bg1 p-[18px] md:px-7 md:py-[26px] ${
        hasRoad ? "md:grid md:grid-cols-[1.25fr_1fr] md:gap-7" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between gap-2 text-[12.5px] text-fg3 md:mb-2.5 md:justify-start md:text-[13px]">
          <span>Tu meta de {monthName}</span>
          {goal.metaUsd != null && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="relative inline-flex items-center gap-[5px] rounded-lg border border-separator2 px-2 py-[3px] text-xs text-fg2 hover:bg-bg2 after:absolute after:-inset-2 after:content-[''] md:text-[12.5px]"
            >
              <Pencil aria-hidden className="h-3 w-3" />
              Editar
            </button>
          )}
        </div>
        {editing || goal.metaUsd == null ? (
          editing ? (
            <GoalEditor
              initial={goal.metaUsd}
              onCancel={() => setEditing(false)}
              onSave={async (value) => {
                await onSaveGoal(value);
                setEditing(false);
              }}
            />
          ) : (
            <NoGoal onSaveGoal={onSaveGoal} />
          )
        ) : (
          <>
            <p className="text-[17px] leading-[1.35] text-fg2 md:text-2xl md:leading-[1.3]">
              Llevas{" "}
              <b className="block font-display text-[32px] font-semibold leading-tight tracking-[-0.01em] text-fg0 md:inline md:text-[40px]">
                {usd(goal.llevasUsd)}
              </b>{" "}
              de <b className="font-semibold text-fg0">{usd(goal.metaUsd)}</b> de comisión este mes
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={goal.barPct}
              aria-label="Avance de tu meta"
              className="mb-1.5 mt-3.5 h-2.5 overflow-hidden rounded-full border border-separator1 bg-bg2 md:mb-2 md:mt-[18px] md:h-3"
            >
              <i className="block h-full rounded-full bg-fg0" style={{ width: `${goal.barPct}%` }} />
            </div>
            <div className="flex justify-between text-xs text-fg3 md:text-[13px]">
              <span>{goal.pct} %</span>
              <span>{goal.daysLabel}</span>
            </div>
          </>
        )}
      </div>
      {hasRoad && (
        <div className="mt-3.5 flex min-w-0 flex-col justify-center border-t border-separator1 pt-3.5 md:mt-0 md:border-l md:border-t-0 md:pl-7 md:pt-0">
          <p className="mb-2 hidden items-center text-[13px] text-fg3 md:flex">
            Para llegar
            {roadTip}
          </p>
          {paraLlegar.headline && (
            <p className="text-base font-semibold leading-[1.3] text-fg0 md:text-[22px]">
              {paraLlegar.headline}
              {!paraLlegar.meetings && <span className="md:hidden">{roadTip}</span>}
            </p>
          )}
          {paraLlegar.meetings && (
            <p className="mt-[3px] text-[13.5px] text-fg2 md:mt-1.5 md:text-[15px]">
              {paraLlegar.meetings}
              <span className="md:hidden">{roadTip}</span>
            </p>
          )}
          {paraLlegar.closeWhen && (
            <p className="mt-2 text-xs text-fg3 md:mt-4 md:text-[13px]">
              {paraLlegar.closeWhen}
              {paraLlegar.closeCalls && (
                <>
                  <span aria-hidden className="mx-1 md:mx-2.5">·</span>
                  {paraLlegar.closeCalls}
                </>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function NoGoal({ onSaveGoal }: { onSaveGoal: (usd: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (open) return <GoalEditor initial={null} onCancel={() => setOpen(false)} onSave={onSaveGoal} />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[17px] leading-[1.35] text-fg2 md:text-2xl">Ponte una meta de comisión para este mes</p>
      <button type="button" onClick={() => setOpen(true)} className={DARK_BUTTON}>
        Poner meta
      </button>
    </div>
  );
}

function ConfirmBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-[14px] border border-[#EBD3A8] bg-[#F6E7CC] py-2 pl-3 pr-2 md:gap-3 md:py-3 md:pl-[18px] md:pr-3.5">
      <p className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium text-[#5E3B0B] md:text-[15px]">
        <Phone aria-hidden className="hidden h-4 w-4 shrink-0 md:block" />
        {count === 1 ? "Tienes 1 llamada por confirmar" : `Tienes ${count} llamadas por confirmar`}
      </p>
      <Link
        href="/llamadas#por-clasificar"
        className="inline-flex h-11 min-h-11 shrink-0 items-center whitespace-nowrap rounded-[9px] bg-[#5E3B0B] px-2.5 text-[13px] md:px-[11px] font-medium text-[#FFF7EA] hover:opacity-90 lg:h-8 lg:min-h-0"
      >
        Confirmar →
      </Link>
    </div>
  );
}

function ListRow({
  row,
  busy,
  onOpen,
  onDone,
}: {
  row: InicioRow;
  busy: boolean;
  onOpen: (row: InicioRow) => void;
  onDone: (row: InicioRow) => void;
}) {
  const amount = row.commissionUsd != null ? `+${usd(row.commissionUsd)}` : "";
  return (
    <li className="inicio-row rounded-2xl border border-separator1 bg-bg1 p-3.5 lg:rounded-none lg:border-0 lg:border-t lg:bg-transparent lg:px-6 lg:py-3.5">
      <button
        type="button"
        className="inicio-open text-left"
        aria-label={`Qué le mandas a ${row.name}`}
        onClick={() => onOpen(row)}
      >
      <div
        aria-hidden
        className="inicio-av grid h-[38px] w-[38px] place-items-center rounded-full bg-bg2 text-[13px] font-semibold text-fg2 lg:h-10 lg:w-10 lg:text-sm"
      >
        {row.initials}
      </div>
      <div className="inicio-who min-w-0">
        <p className="truncate text-base font-semibold text-fg0 lg:overflow-visible lg:whitespace-normal">{row.name}</p>
        {row.offer && (
          <p className="truncate text-[12.5px] text-fg3 lg:mt-0.5 lg:overflow-visible lg:whitespace-normal lg:text-[13px]">
            {row.offer}
          </p>
        )}
      </div>
      <div className="inicio-pr min-w-0">
        <p className="mt-2.5 text-[15px] text-fg0 lg:mt-0">{row.step}</p>
        <div className="mt-1.5 lg:mt-[5px]">
          <WhenChip tone={row.chip.tone} label={row.chip.label} />
        </div>
      </div>
      <div className="inicio-mo text-right">
        {amount && (
          <>
            <p className="whitespace-nowrap text-[15px] font-semibold text-fg0 lg:text-base">{amount}</p>
            {row.commissionLabel && (
              <p className="hidden text-right text-[11px] leading-tight text-fg3 lg:block lg:text-xs">
                {row.commissionLabel}
              </p>
            )}
          </>
        )}
      </div>
      </button>
      <div className="inicio-acts mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 lg:mt-0 lg:flex">
        {row.whatsappHref ? (
          <a href={row.whatsappHref} target="_blank" rel="noreferrer" className={DARK_BUTTON}>
            <WhatsAppGlyph />
            WhatsApp
          </a>
        ) : (
          <span className="inline-flex" title={`Falta el teléfono de ${row.name}. Agrégalo en el CRM.`}>
            <button
              type="button"
              disabled
              aria-label={`WhatsApp: falta el teléfono de ${row.name}`}
              className={`${DARK_BUTTON} w-full cursor-not-allowed opacity-50`}
            >
              <WhatsAppGlyph />
              WhatsApp
            </button>
          </span>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onDone(row)}
          className={`${LINE_BUTTON} disabled:opacity-60`}
        >
          <Check aria-hidden className="h-4 w-4" strokeWidth={2.2} />
          Hecho
        </button>
      </div>
    </li>
  );
}

function TodayList({
  inicio,
  onChanged,
}: {
  inicio: InicioBlock;
  onChanged: () => void;
}) {
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    setRemoved(new Set());
  }, [inicio]);
  const rows = useMemo(
    () => inicio.list.rows.filter((row) => !removed.has(row.id)),
    [inicio.list.rows, removed],
  );
  const openRow = rows.find((row) => row.id === openId) || null;
  const more = inicio.list.more;

  const markDone = async (row: InicioRow) => {
    if (busy) return;
    setBusy(row.id);
    setRemoved((prev) => new Set(prev).add(row.id));
    try {
      const response = await fetch("/api/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: row.id, action: "outcome", resultado: "hecho" }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se guardó. Inténtalo otra vez.");
      setOpenId(null);
      toast({
        title: row.closesOnHecho
          ? `Listo, ${row.name} salió de tu lista`
          : `Listo, anoté el paso con ${row.name}`,
        duration: 3000,
      });
      invalidateHub();
      onChanged();
    } catch (error) {
      setRemoved((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      toast({
        title: error instanceof Error && error.message ? error.message : "No se guardó. Inténtalo otra vez.",
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      setBusy(null);
    }
  };

  const crmLink = (
    <Link href="/crm#seguimientos" className="font-medium text-fg0 hover:underline">
      Ver en el CRM →
    </Link>
  );

  return (
    <section aria-labelledby="lista-hoy" className="min-w-0 lg:rounded-2xl lg:border lg:border-separator1 lg:bg-bg1 lg:pb-1 lg:pt-2">
      <div className="mx-1 mb-2.5 mt-[18px] flex items-baseline justify-between gap-3 lg:m-0 lg:px-6 lg:pb-2.5 lg:pt-4">
        <h2 id="lista-hoy" className="flex items-center font-display text-[22px] font-semibold text-fg0 lg:text-2xl">
          Tu lista de hoy
          <InfoTip label="Cómo se ordena tu lista">
            <p>
              Primero va quien tiene más dinero en juego. Sin monto, quien lleva más días sin respuesta, después
              la etapa y al final el nombre. Es el mismo orden de «¿A quién llamo hoy?».
            </p>
            <p>
              La comisión sale de la regla de comisión de cada oferta. Si la oferta no la tiene, no te muestro
              un número.
            </p>
            <p>Hecho cierra ese seguimiento: sale de la lista y deja de contar en pendientes.</p>
          </InfoTip>
        </h2>
        <span className="hidden text-[13px] text-fg3 lg:inline">{listSubtitle(inicio.goal.metaUsd != null)}</span>
        {rows.length > 0 && (
          <span className="text-xs text-fg3 lg:hidden">
            {rows.length === 1 ? "1 persona" : `${rows.length} personas`}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-separator1 bg-bg1 px-4 py-5 text-[15px] text-fg2 lg:rounded-none lg:border-0 lg:border-t lg:bg-transparent lg:px-6">
          <p>Hoy no tienes seguimientos pendientes</p>
          {more > 0 && <p className="mt-1 text-sm">{crmLink}</p>}
        </div>
      ) : (
        <ul className="space-y-2.5 lg:space-y-0">
          {rows.map((row) => (
            <ListRow
              key={row.id}
              row={row}
              busy={busy === row.id}
              onOpen={(target) => setOpenId(target.id)}
              onDone={(target) => void markDone(target)}
            />
          ))}
        </ul>
      )}
      <PersonSheet
        row={openRow}
        open={Boolean(openRow)}
        busy={busy === openRow?.id}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        onDone={(target) => void markDone(target)}
      />
      {rows.length > 0 && (
        <>
          <p className="mb-3.5 mt-1 text-center text-[13.5px] text-fg2 lg:hidden">
            {more > 0 ? `${more} más en seguimiento · ` : ""}
            {crmLink}
          </p>
          <p className="hidden border-t border-separator1 px-6 py-3.5 text-sm text-fg2 lg:block">
            {more > 0 ? `Hay ${more === 1 ? "1 persona más" : `${more} personas más`} en seguimiento · ` : ""}
            {crmLink}
          </p>
        </>
      )}
    </section>
  );
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name.trim();
}

async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: "Copié el mensaje", duration: 2000 });
  } catch {
    toast({ title: "No pude copiarlo. Selecciónalo y cópialo a mano.", variant: "destructive", duration: 3000 });
  }
}

function WhatsAppAction({
  phone,
  text,
  name,
  className,
  label = "Abrir WhatsApp",
}: {
  phone: string;
  text: string;
  name: string;
  className: string;
  label?: string;
}) {
  if (!phone) {
    return (
      <span className="inline-flex" title={`Falta el teléfono de ${name}. Agrégalo en el CRM.`}>
        <button type="button" disabled aria-label={`WhatsApp: falta el teléfono de ${name}`} className={`${className} cursor-not-allowed opacity-50`}>
          <WhatsAppGlyph />
          {label}
        </button>
      </span>
    );
  }
  return (
    <a href={whatsappClickHref(phone, text)} target="_blank" rel="noreferrer" className={className}>
      <WhatsAppGlyph />
      {label}
    </a>
  );
}

function PersonSheet({
  row,
  open,
  busy,
  onOpenChange,
  onDone,
}: {
  row: InicioRow | null;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (row: InicioRow) => void;
}) {
  const mobile = useIsMobile();
  const [drafts, setDrafts] = useState<string[]>([]);
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    setDrafts(row?.messages || []);
    setPicked(0);
  }, [row]);
  if (!row) return null;
  const blocks = sheetBlocks({
    agreement: row.agreement,
    nextStep: row.step,
    when: row.whenDate,
    age: row.whenAge,
    messages: drafts,
    material: row.material,
    phone: row.phone,
  });
  const chosen = (drafts[picked] || drafts.find((item) => item.trim()) || "").trim();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={
          mobile
            ? "max-h-[92vh] overflow-y-auto rounded-t-2xl border-separator1 bg-bg0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "w-full overflow-y-auto border-separator1 bg-bg0 px-4 py-5 sm:max-w-md"
        }
      >
        <div className="flex items-start gap-3 pr-10">
          <div
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-bg2 text-sm font-semibold text-fg2"
          >
            {row.initials}
          </div>
          <div className="min-w-0">
            <SheetTitle className="text-left font-display text-xl leading-tight text-fg0">
              ¿Qué le mandas a {firstName(row.name)}?
            </SheetTitle>
            <SheetDescription className="text-left text-[13px] text-fg3">
              {row.name}
              {row.offer ? ` · ${row.offer}` : ""}
              {blocks.phone ? ` · ${blocks.phone}` : ""}
            </SheetDescription>
          </div>
        </div>
        {(blocks.agreement || blocks.nextStep || blocks.when || blocks.age) && (
          <section className="rounded-2xl border border-[#EBD3A8] bg-[#F6E7CC] px-3.5 py-3 text-[14px] leading-snug text-[#5E3B0B]">
            {blocks.agreement && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7A4C0E]">En qué quedaron</p>
                <p className="mt-1">{blocks.agreement}</p>
              </div>
            )}
            {blocks.nextStep && (
              <div className={blocks.agreement ? "mt-2.5 border-t border-[#EBD3A8] pt-2.5" : ""}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7A4C0E]">Siguiente paso</p>
                <p className="mt-1 text-fg0">{blocks.nextStep}</p>
              </div>
            )}
            {(blocks.when || blocks.age) && (
              <div
                className={
                  blocks.agreement || blocks.nextStep ? "mt-2.5 border-t border-[#EBD3A8] pt-2.5" : ""
                }
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#7A4C0E]">Cuándo</p>
                {blocks.when && <p className="mt-1 text-fg0">{blocks.when}</p>}
                {blocks.age && <p className="mt-1">{blocks.age}</p>}
              </div>
            )}
          </section>
        )}
        {drafts.length > 0 && (
          <ul className="space-y-2">
            {drafts.map((text, index) => (
              <li
                key={`${row.id}-${index}`}
                className={`rounded-2xl border bg-bg1 p-3 ${picked === index ? "border-fg0" : "border-separator1"}`}
              >
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`mensaje-${row.id}`}
                    className="mt-1"
                    checked={picked === index}
                    onChange={() => setPicked(index)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mb-1 block text-[11px] font-medium text-fg3">
                      {index === 0 ? "Sugerido" : `Opción ${index + 1}`}
                    </span>
                    <textarea
                      value={text}
                      rows={3}
                      aria-label={`Mensaje ${index + 1}`}
                      onChange={(event) => {
                        const next = [...drafts];
                        next[index] = event.target.value;
                        setDrafts(next);
                        setPicked(index);
                      }}
                      className="min-h-[4.5rem] w-full resize-y bg-transparent text-[14px] leading-snug text-fg0 outline-none"
                    />
                  </span>
                </label>
                <p className="mt-1 text-[11px] text-fg3">Puedes editarlo aquí mismo</p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button type="button" className={LINE_BUTTON} onClick={() => void copyMessage(text)}>
                    Copiar
                  </button>
                  <WhatsAppAction
                    phone={blocks.phone}
                    text={text}
                    name={row.name}
                    className={DARK_BUTTON}
                    label="Abrir WhatsApp"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {blocks.material.length > 0 && (
          <section className="rounded-2xl border border-separator1 bg-bg1 p-3">
            <p className="mb-1 text-xs font-medium text-fg3">Material sugerido</p>
            <ul className="space-y-1 text-[14px] text-fg0">
              {blocks.material.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
        <div className="mt-auto grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <WhatsAppAction phone={blocks.phone} text={chosen} name={row.name} className={DARK_BUTTON} label="WhatsApp" />
          <button type="button" disabled={busy} onClick={() => onDone(row)} className={`${LINE_BUTTON} disabled:opacity-60`}>
            <Check aria-hidden className="h-4 w-4" strokeWidth={2.2} />
            Hecho
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className={LINE_BUTTON}>
            Cerrar
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StartCard({
  steps,
  onSaveGoal,
}: {
  steps: InicioBlock["onboarding"];
  onSaveGoal: (usd: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const items = [
    {
      done: steps.goalDone,
      title: "Pon tu meta de comisión del mes",
      href: "",
    },
    {
      done: steps.offerDone,
      title: "Carga tu oferta (precios, comisión, guiones)",
      href: "/ofertas",
    },
    {
      done: steps.callDone,
      title: "Conecta o sube tu primera llamada",
      href: "/llamadas",
    },
  ];
  return (
    <section aria-label="Empieza en 3 pasos" className="rounded-2xl border border-separator1 bg-bg1 p-4 md:px-6 md:py-5">
      <h2 className="font-display text-[22px] font-semibold text-fg0">Empieza en 3 pasos</h2>
      <ol className="mt-3 space-y-2">
        {items.map((item, index) => (
          <li key={item.title} className="flex items-start gap-3 rounded-xl border border-separator1 px-3 py-3">
            <span
              aria-hidden
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                item.done ? "bg-fg0 text-[#FBF8F2]" : "bg-bg2 text-fg2"
              }`}
            >
              {item.done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              {item.href ? (
                <Link href={item.href} className="text-[15px] font-medium text-fg0 hover:underline">
                  {item.title}
                </Link>
              ) : editing ? (
                <GoalEditor initial={null} onCancel={() => setEditing(false)} onSave={onSaveGoal} />
              ) : (
                <button type="button" onClick={() => setEditing(true)} className="text-left text-[15px] font-medium text-fg0 hover:underline">
                  {item.title}
                </button>
              )}
              {item.done && <p className="text-xs text-fg3">Listo</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FrenaCard({ card }: { card: PracticeCard | null }) {
  if (!card?.pattern) return null;
  return (
    <section
      aria-label="Lo que más te frena"
      className="rounded-2xl border border-separator1 bg-bg1 p-4 md:flex md:items-center md:justify-between md:gap-6 md:px-6 md:py-[18px]"
    >
      <div className="min-w-0">
        <p className="text-xs text-fg3 md:mb-1 md:text-[13px]">Lo que más te frena</p>
        <p className="mb-3 mt-1 text-[15px] font-medium text-fg0 md:m-0 md:text-[17px]">{card.pattern}</p>
      </div>
      <Link href={card.practiceHref} className={`${DARK_BUTTON} w-full md:w-auto lg:h-10 lg:px-3.5 lg:text-sm`}>
        ▶ Practicar 5 min
      </Link>
    </section>
  );
}

export function InicioHome({
  inicio,
  projection,
  onRefresh,
}: {
  inicio: InicioBlock | null;
  projection: CommissionProjection | null;
  onRefresh: () => void;
}) {
  const [practice, setPractice] = useState<PracticeCard | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/hub/practice")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { practiceHref?: string; drill?: string; pattern?: string } | null) => {
        if (cancelled || !data?.pattern) return;
        setPractice({
          practiceHref: data.practiceHref || "/practicar",
          drill: data.drill || "",
          pattern: data.pattern,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const saveGoal = async (amount: number) => {
    const response = await fetch("/api/hub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthlyGoalUsd: amount }),
    });
    if (!response.ok) throw new Error("No se guardó");
    invalidateHub();
    toast({ title: `Guardé tu meta: ${usd(amount)}`, duration: 3000 });
    onRefresh();
  };

  if (!inicio) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">No pude armar tu lista de hoy.</p>
        <button type="button" onClick={onRefresh} className={LINE_BUTTON}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-4">
      <p className="mx-1 text-[12.5px] text-fg3 md:mx-0 md:text-[13px]">{inicio.dateLine}</p>
      {inicio.onboarding.show ? (
        <StartCard onSaveGoal={saveGoal} steps={inicio.onboarding} />
      ) : (
        <GoalCard inicio={inicio} projection={projection} onSaveGoal={saveGoal} />
      )}
      <ConfirmBanner count={inicio.porConfirmar} />
      {!inicio.onboarding.show && <TodayList inicio={inicio} onChanged={onRefresh} />}
      <FrenaCard card={practice} />
    </div>
  );
}
