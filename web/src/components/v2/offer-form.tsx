"use client";
// New / edit offer. «Sube tu oferta»: the text or PDF goes to
// /api/offer-from-doc, which proposes name, description and price; nothing
// is saved until the person reviews the fields and presses «Guardar».
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { type OfferFormState, saveOfferAction } from "@/app/(v2)/ofertas/actions";
import { Submit } from "./submit";

export type OfferFormValues = {
  id: string | null;
  name: string;
  description: string;
  currency: string;
  priceCash: string;
  installmentsCount: string;
  installmentAmount: string;
  commissionType: string;
  commissionValue: string;
};

type Proposal = {
  productName?: string;
  productDescription?: string;
  commercial?: { listPrice?: number | null; currency?: string } | null;
  error?: string;
};

export function OfferForm({ initial, tab, cancelHref }: { initial: OfferFormValues; tab: string; cancelHref: string }) {
  const [state, action] = useActionState<OfferFormState, FormData>(saveOfferAction, { error: null });
  const [values, setValues] = useState(initial);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const set = (k: keyof OfferFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

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
      setValues((v) => ({
        ...v,
        name: v.name || data.productName || "",
        description: v.description || data.productDescription || paste,
        currency: data.commercial?.currency || v.currency,
        priceCash: v.priceCash || (data.commercial?.listPrice != null ? String(data.commercial.listPrice) : ""),
      }));
      setReadNote("Revisa lo que entendí y completa lo que falte. Tu comisión la pones tú.");
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
          Nombre de la oferta
          <input name="name" required maxLength={120} value={values.name} onChange={set("name")} />
        </label>
        <div className="row3">
          <label className="field">
            Precio de contado
            <input name="priceCash" inputMode="decimal" placeholder="10.000" value={values.priceCash} onChange={set("priceCash")} />
          </label>
          <label className="field">
            Número de cuotas
            <input name="installmentsCount" type="number" min={1} max={60} value={values.installmentsCount} onChange={set("installmentsCount")} />
          </label>
          <label className="field">
            Valor de cada cuota
            <input name="installmentAmount" inputMode="decimal" value={values.installmentAmount} onChange={set("installmentAmount")} />
          </label>
        </div>
        <div className="row3">
          <label className="field">
            Moneda
            <select name="currency" value={values.currency} onChange={set("currency")}>
              {["USD", "COP", "MXN", "EUR", "ARS", "CLP", "PEN"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="field">
            ¿Cómo te pagan?
            <select name="commissionType" value={values.commissionType} onChange={set("commissionType")}>
              <option value="">Todavía no lo sé</option>
              <option value="PER_CLOSE">Un monto fijo por cada cierre</option>
              <option value="PCT_SALE">Un porcentaje de la venta</option>
              <option value="PCT_CASH">Un porcentaje de lo que se cobra</option>
            </select>
          </label>
          <label className="field">
            {pct ? "Porcentaje" : "Monto por cierre"}
            <input
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
          De qué se trata (opcional)
          <textarea name="description" value={values.description} onChange={set("description")} />
        </label>
        {state.error && <div className="banner err">{state.error}</div>}
        <div className="actions">
          <Link href={cancelHref} className="link">Cancelar</Link>
          <Submit pending="Guardando…">Guardar</Submit>
        </div>
      </form>
    </div>
  );
}
