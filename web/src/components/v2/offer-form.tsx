"use client";
// New / edit offer. «Sube tu oferta»: the text or PDF goes to
// /api/offer-from-doc, which proposes fields. Proposed fields show «sugerido»
// until the person touches them; nothing is saved until «Guardar», and
// saving the form is the confirmation.
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { type OfferFormState, saveOfferAction } from "@/app/(v2)/ofertas/actions";
import { type OfferFields, type OfferProposal, applyProposal } from "@/lib/offers/proposal";
import { Submit } from "./submit";

export type OfferFormValues = OfferFields & { id: string | null };

type Proposal = OfferProposal & { error?: string };

export function OfferForm({ initial, tab, cancelHref }: { initial: OfferFormValues; tab: string; cancelHref: string }) {
  const [state, action] = useActionState<OfferFormState, FormData>(saveOfferAction, { error: null });
  const [values, setValues] = useState(initial);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Set<keyof OfferFields>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const set = (k: keyof OfferFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [k]: value }));
    // touching a field makes it the person's own
    setSuggested((s) => {
      if (!s.has(k)) return s;
      const next = new Set(s);
      next.delete(k);
      return next;
    });
  };
  const tag = (k: keyof OfferFields) => (suggested.has(k) ? <span className="pill amber sug">sugerido</span> : null);
  const cls = (k: keyof OfferFields) => (suggested.has(k) ? "suggested" : undefined);

  async function readDoc() {
    const body = new FormData();
    const paste = pasteRef.current?.value.trim() ?? "";
    const file = fileRef.current?.files?.[0];
    if (!paste && !file) {
      setReadNote("Pega el texto o elige un PDF primero.");
      return;
    }
    if (paste) body.set("paste", paste);
    if (file) body.set("file", file);
    setReading(true);
    setReadNote(null);
    try {
      const res = await fetch("/api/offer-from-doc", { method: "POST", body });
      const data = (await res.json()) as Proposal;
      if (!res.ok) {
        setReadNote(data.error ?? "No pude leerla. Inténtalo de nuevo.");
        return;
      }
      const applied = applyProposal(values, data, paste);
      setValues((v) => ({ ...applied.values, id: v.id }));
      setSuggested(new Set(applied.suggested));
      setReadNote(
        applied.suggested.length
          ? "Marqué como «sugerido» lo que leí. Revísalo: nada se guarda hasta que pulses Guardar."
          : "No encontré precios ni comisión en el texto. Complétalos tú.",
      );
    } catch {
      setReadNote("No pude leerla. Inténtalo de nuevo.");
    } finally {
      setReading(false);
    }
  }

  const pct = values.commissionType === "PCT_SALE" || values.commissionType === "PCT_CASH";

  return (
    <div className="form">
      {!initial.id && (
        <details className="case">
          <summary className="nm">Sube tu oferta (texto o PDF) y la leo por ti</summary>
          <div className="form" style={{ marginTop: 12 }}>
            <label className="field">
              Pega el texto de tu oferta
              <textarea ref={pasteRef} placeholder="Lo que vendes, el precio, las formas de pago…" />
            </label>
            <label className="field">
              O elige un PDF
              <input ref={fileRef} type="file" accept=".pdf,.txt,application/pdf,text/plain" />
            </label>
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="btn sec sm" onClick={readDoc} disabled={reading}>
                {reading ? "Leyendo…" : "Leer mi oferta"}
              </button>
              {readNote && <span className="small muted">{readNote}</span>}
            </div>
          </div>
        </details>
      )}

      <form action={action} className="form">
        {values.id && <input type="hidden" name="id" value={values.id} />}
        <input type="hidden" name="tab" value={tab} />
        <label className="field">
          <span>Nombre de la oferta {tag("name")}</span>
          <input className={cls("name")} name="name" required maxLength={120} value={values.name} onChange={set("name")} />
        </label>
        <div className="row3">
          <label className="field">
            <span>Precio de contado {tag("priceCash")}</span>
            <input className={cls("priceCash")} name="priceCash" inputMode="decimal" placeholder="10.000" value={values.priceCash} onChange={set("priceCash")} />
          </label>
          <label className="field">
            <span>Número de cuotas {tag("installmentsCount")}</span>
            <input className={cls("installmentsCount")} name="installmentsCount" type="number" min={1} max={60} value={values.installmentsCount} onChange={set("installmentsCount")} />
          </label>
          <label className="field">
            <span>Valor de cada cuota {tag("installmentAmount")}</span>
            <input className={cls("installmentAmount")} name="installmentAmount" inputMode="decimal" value={values.installmentAmount} onChange={set("installmentAmount")} />
          </label>
        </div>
        <div className="row3">
          <label className="field">
            <span>Moneda {tag("currency")}</span>
            <select className={cls("currency")} name="currency" value={values.currency} onChange={set("currency")}>
              {["USD", "COP", "MXN", "EUR", "ARS", "CLP", "PEN"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>¿Cómo te pagan? {tag("commissionType")}</span>
            <select className={cls("commissionType")} name="commissionType" value={values.commissionType} onChange={set("commissionType")}>
              <option value="">Todavía no lo sé</option>
              <option value="PER_CLOSE">Un monto fijo por cada cierre</option>
              <option value="PCT_SALE">Un porcentaje de la venta</option>
              <option value="PCT_CASH">Un porcentaje de lo que se cobra</option>
            </select>
          </label>
          <label className="field">
            <span>{pct ? "Porcentaje" : "Monto por cierre"} {tag("commissionValue")}</span>
            <input
              className={cls("commissionValue")}
              name="commissionValue"
              inputMode="decimal"
              placeholder={pct ? "10" : "900"}
              disabled={!values.commissionType}
              value={values.commissionValue}
              onChange={set("commissionValue")}
            />
          </label>
        </div>
        {pct && !values.priceCash && (
          <p className="small" style={{ color: "#7A4C0E" }}>
            Para saber cuánto ganas por cierre con un porcentaje necesito el precio de contado.
          </p>
        )}
        <label className="field">
          <span>De qué se trata (opcional) {tag("description")}</span>
          <textarea className={cls("description")} name="description" value={values.description} onChange={set("description")} />
        </label>
        {suggested.size > 0 && (
          <p className="small" style={{ color: "#7A4C0E" }}>
            Lo marcado como «sugerido» lo leí de tu oferta. Al pulsar Guardar confirmas que está bien.
          </p>
        )}
        {state.error && <div className="banner err">{state.error}</div>}
        <div className="actions">
          <Link href={cancelHref} className="link">Cancelar</Link>
          <Submit pending="Guardando…">Guardar</Submit>
        </div>
      </form>
    </div>
  );
}
