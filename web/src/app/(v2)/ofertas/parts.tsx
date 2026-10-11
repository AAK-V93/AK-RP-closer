// Tab bodies of Mis ofertas. Server components; forms post to Server Actions.
import Link from "next/link";
import { caseFields } from "@/lib/cases/view";
import { bestScriptId, offerCompleteness, scriptUsage } from "@/lib/metrics";
import type { OfferCard, OfferCaseDto, OfferCases } from "@/lib/read/offers";
import { COMMISSION_TYPE_LABEL, SCRIPT_ORIGIN_LABEL, commissionLine, commissionValueText, installmentsText, shortDate } from "@/lib/format/offer";
import { formatMoney } from "@/lib/format/money";
import type { OfferFormValues } from "@/components/v2/offer-form";
import { DrivePickerButton } from "@/components/v2/drive-picker";
import { IconChev, IconPlus } from "@/components/v2/icons";
import { Submit } from "@/components/v2/submit";
import {
  addLinksAction,
  addManualCaseAction,
  archiveOfferAction,
  deleteScriptAction,
  saveReviewAction,
  saveScriptAction,
  syncSourceAction,
} from "./actions";

export function hrefFor(offerId: string | null, tab?: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams();
  if (offerId) q.set("oferta", offerId);
  if (tab) q.set("tab", tab);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return `/ofertas${s ? `?${s}` : ""}`;
}

export function offerFormValues(o: OfferCard | null): OfferFormValues {
  return {
    id: o?.id ?? null,
    name: o?.name ?? "",
    description: o?.description ?? "",
    currency: o?.currency ?? "USD",
    priceCash: o?.priceCash?.replace(/\.00$/, "") ?? "",
    installmentsCount: o?.installmentsCount ? String(o.installmentsCount) : "",
    installmentAmount: o?.installmentAmount?.replace(/\.00$/, "") ?? "",
    commissionType: o?.commissionType ?? "",
    commissionValue: o?.commissionValue?.replace(/\.00$/, "") ?? "",
  };
}

export function archiveForm(offerId: string) {
  return (
    <form action={archiveOfferAction} style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <input type="hidden" name="id" value={offerId} />
      <span className="small muted">¿Ya no vendes esta oferta? </span>
      <button type="submit" className="link danger small">Archivarla</button>
    </form>
  );
}

function Missing({ offerId, tab, text, action }: { offerId: string; tab: string; text: string; action: string }) {
  return (
    <div className="fix" style={{ marginTop: 0 }}>
      <span>{text}</span>
      <Link className="btn sm fixit" href={hrefFor(offerId, tab, { editar: "1" })}>{action}</Link>
    </div>
  );
}

export function PricesTab({ offer }: { offer: OfferCard }) {
  const cash = formatMoney(offer.priceCash, offer.currency);
  const cuotas = installmentsText(offer);
  return (
    <div className="body">
      {!cash && !cuotas ? (
        <Missing offerId={offer.id} tab="precios" text="Todavía no tiene precio" action="Agregar precio" />
      ) : (
        <div className="kv">
          <div className="k">De contado</div>
          <div>{cash ?? "Todavía no lo pusiste"}</div>
          <div className="k">En cuotas</div>
          <div>{cuotas ?? "Todavía no lo pusiste"}</div>
          <div className="k">Moneda</div>
          <div>{offer.currency}</div>
        </div>
      )}
      {offer.description && (
        <details style={{ marginTop: 18 }}>
          <summary className="link">De qué se trata</summary>
          <p className="note" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{offer.description}</p>
        </details>
      )}
    </div>
  );
}

export function CommissionTab({ offer }: { offer: OfferCard }) {
  const { perClose } = offerCompleteness(offer);
  const line = commissionLine(perClose, offer.currency);
  const value = commissionValueText(offer.commissionType, offer.commissionValue, offer.currency);
  if (!offer.commissionType || value === null) {
    return (
      <div className="body">
        <Missing offerId={offer.id} tab="comision" text="Todavía no sabes cuánto ganas por cierre" action="Agregar tu comisión" />
      </div>
    );
  }
  return (
    <div className="body">
      <div className="kv">
        <div className="k">Cómo te pagan</div>
        <div>{COMMISSION_TYPE_LABEL[offer.commissionType]}</div>
        <div className="k">{offer.commissionType === "PER_CLOSE" ? "Monto" : "Porcentaje"}</div>
        <div>{value}</div>
        <div className="k">Por cada cierre</div>
        <div>{perClose.cents !== null ? <b>{line.value}</b> : "Por confirmar"}</div>
      </div>
      {perClose.missing === "PRICE" && (
        <div style={{ marginTop: 16 }}>
          <Missing offerId={offer.id} tab="precios" text="Falta el precio de contado para saber cuánto ganas por cierre" action="Agregar precio de contado" />
        </div>
      )}
    </div>
  );
}

type ScriptRow = { id: string; offerId: string | null; title: string; body: string; origin: "EMPRESA" | "APP" | "PROPIO"; usesCount: number; repliesCount: number; paidCount: number };

function ScriptForm({ offerId, script }: { offerId: string; script: ScriptRow | null }) {
  return (
    <form action={saveScriptAction} className="form">
      <input type="hidden" name="offerId" value={offerId} />
      {script && <input type="hidden" name="id" value={script.id} />}
      <label className="field">
        Cuándo lo usas
        <input name="title" required maxLength={140} defaultValue={script?.title ?? ""} placeholder="Cuando te dicen «lo tengo que consultar»" />
      </label>
      <label className="field">
        El mensaje
        <textarea name="body" required defaultValue={script?.body ?? ""} placeholder="Hola [nombre], …" style={{ minHeight: 140 }} />
      </label>
      <label className="field" style={{ maxWidth: 280 }}>
        ¿De dónde salió?
        <select name="origin" defaultValue={script?.origin ?? "PROPIO"}>
          <option value="PROPIO">Lo escribí yo</option>
          <option value="EMPRESA">Me lo dio mi empresa</option>
          {script?.origin === "APP" && <option value="APP">Sugerido por la app</option>}
        </select>
      </label>
      <div className="actions">
        <Link href={hrefFor(offerId, "guiones")} className="link">Cancelar</Link>
        <Submit pending="Guardando…">Guardar guion</Submit>
      </div>
    </form>
  );
}

export function ScriptsTab({ offer, data, open, all }: { offer: OfferCard; data: { scripts: ScriptRow[]; hasMore: boolean }; open: string; all: boolean }) {
  const best = bestScriptId(data.scripts);
  const current = data.scripts.find((s) => s.id === open) ?? null;
  if (open === "nuevo") {
    return (
      <div className="body">
        <h3 className="sub">Nuevo guion</h3>
        <ScriptForm offerId={offer.id} script={null} />
      </div>
    );
  }
  if (current) {
    const u = scriptUsage(current);
    return (
      <div className="body">
        <p className="small muted" style={{ marginBottom: 10 }}>
          <Link href={hrefFor(offer.id, "guiones")} className="link small">Volver a tus guiones</Link>
        </p>
        <p className="small muted" style={{ marginBottom: 12 }}>
          {[u.used, current.usesCount ? u.replies : null, u.paid].filter(Boolean).join(" · ")}
        </p>
        <ScriptForm offerId={offer.id} script={current} />
        <form action={deleteScriptAction} style={{ marginTop: 14 }}>
          <input type="hidden" name="id" value={current.id} />
          <input type="hidden" name="offerId" value={offer.id} />
          <button type="submit" className="link danger small">Borrar este guion</button>
        </form>
      </div>
    );
  }
  if (!data.scripts.length) {
    return (
      <div className="body">
        <p className="note">Todavía no hay guiones para esta oferta. Agrega los mensajes que ya usas y aquí verás cuántas veces te respondieron.</p>
        <div className="actions" style={{ marginTop: 14, justifyContent: "flex-start" }}>
          <Link href={hrefFor(offer.id, "guiones", { guion: "nuevo" })} className="btn pri sm"><IconPlus />Agregar guion</Link>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="sl">
        {data.scripts.map((s) => {
          const u = scriptUsage(s);
          return (
            <Link key={s.id} href={hrefFor(offer.id, "guiones", { guion: s.id })} className="sr">
              <div style={{ minWidth: 0 }}>
                <div className="t">{s.title}</div>
                <div className="s">«{s.body.slice(0, 90)}{s.body.length > 90 ? "…" : ""}»</div>
              </div>
              <div className="r">
                {s.usesCount ? [u.used, u.paid ?? u.replies].join(" · ") : u.used}
              </div>
              {s.id === best ? (
                <span className="pill green">El que mejor funciona</span>
              ) : (
                <span className="pill grey">{s.offerId ? SCRIPT_ORIGIN_LABEL[s.origin] : "Para todas tus ofertas"}</span>
              )}
              <span className="chev"><IconChev /></span>
            </Link>
          );
        })}
      </div>
      <div className="dfoot">
        {data.hasMore ? (
          <Link href={hrefFor(offer.id, "guiones", { ver: "todos" })} className="link small">Ver todos los guiones</Link>
        ) : all ? (
          <Link href={hrefFor(offer.id, "guiones")} className="link small">Ver menos</Link>
        ) : (
          <span />
        )}
        <Link href={hrefFor(offer.id, "guiones", { guion: "nuevo" })} className="btn sec sm"><IconPlus />Agregar guion</Link>
      </div>
    </>
  );
}

function CaseCard({ c }: { c: OfferCaseDto }) {
  const f = caseFields(c);
  return (
    <div className="case">
      <div className="nm">{f.name || "Sin nombre"}</div>
      {f.profile && <div className="ln">{f.profile}</div>}
      {f.before && <div className="ln">Antes: {f.before}</div>}
      {f.result && <div className="ln">Logró: {f.result}</div>}
      {f.quote && <div className="ln">«{f.quote}»</div>}
      {f.mediaUrl && (
        <div className="ln"><a className="link small" href={f.mediaUrl} target="_blank" rel="noreferrer">Ver testimonio</a></div>
      )}
    </div>
  );
}

const STATUS_TEXT = { PENDING: "Todavía no lo leo", READY: "Leído", NEEDS_ACCESS: "No tengo acceso", ERROR: "No pude leerlo" } as const;
const KIND_TEXT = { SHEET: "Hoja de Google", YOUTUBE_PLAYLIST: "Lista de YouTube", YOUTUBE_CHANNEL: "Canal de YouTube", YOUTUBE_VIDEO: "Video de YouTube" } as const;

function ReviewForm({ offerId, cases }: { offerId: string; cases: OfferCaseDto[] }) {
  return (
    <form action={saveReviewAction} className="review">
      <input type="hidden" name="offerId" value={offerId} />
      <h3>Encontré {cases.length} {cases.length === 1 ? "caso" : "casos"}, así los entendí</h3>
      <p className="note" style={{ margin: "6px 0 8px" }}>
        Corrige lo que no esté bien. Solo te voy a sugerir los casos que confirmes.
      </p>
      {cases.map((c) => {
        const f = caseFields(c);
        // only suggest «Sí» when the row says who and what changed
        const looksLikeCase = Boolean(f.name && (f.result || f.before));
        return (
          <div key={c.id} className="rcase">
            <input type="hidden" name="caseId" value={c.id} />
            {c.sourceSnippet && (
              <details>
                <summary className="small muted">Lo que leí</summary>
                <div className="snip" style={{ marginTop: 6 }}>{c.sourceSnippet}</div>
              </details>
            )}
            <div className="row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label className="field">Quién es<input name={`${c.id}.name`} defaultValue={f.name ?? ""} /></label>
              <label className="field">A qué se dedica<input name={`${c.id}.profile`} defaultValue={f.profile ?? ""} /></label>
              <label className="field">Cómo estaba antes<input name={`${c.id}.before`} defaultValue={f.before ?? ""} /></label>
              <label className="field">Qué logró<input name={`${c.id}.result`} defaultValue={f.result ?? ""} /></label>
            </div>
            <label className="field">Una frase suya (opcional)<input name={`${c.id}.quote`} defaultValue={f.quote ?? ""} /></label>
            {f.mediaUrl && (
              <a className="link small" href={f.mediaUrl} target="_blank" rel="noreferrer">Ver el testimonio original</a>
            )}
            <div className="choice">
              <label><input type="radio" name={`${c.id}.decision`} value="confirm" defaultChecked={looksLikeCase} />Sí, es un caso de éxito</label>
              <label><input type="radio" name={`${c.id}.decision`} value="dismiss" />No es un caso</label>
              <label><input type="radio" name={`${c.id}.decision`} value="keep" defaultChecked={!looksLikeCase} />Lo decido después</label>
            </div>
          </div>
        );
      })}
      <div className="actions">
        <Submit pending="Guardando…">Guardar</Submit>
      </div>
    </form>
  );
}

export function CasesTab({
  offer,
  data,
  all,
  drive,
  youtube,
}: {
  offer: OfferCard;
  data: OfferCases;
  all: boolean;
  drive: { apiKey: string; appId: string; connected: boolean } | null;
  youtube: boolean;
}) {
  const nothing = !data.confirmed.length && !data.toReview.length && !data.sources.length;
  return (
    <div className="body">
      {data.toReview.length > 0 && <ReviewForm offerId={offer.id} cases={data.toReview} />}

      {data.confirmed.length > 0 ? (
        <>
          <h3 className="sub">Listos para sugerir</h3>
          <div className="cases">
            {data.confirmed.map((c) => <CaseCard key={c.id} c={c} />)}
          </div>
          {data.hasMore && (
            <p style={{ marginTop: 12 }}><Link href={hrefFor(offer.id, "casos", { ver: "todos" })} className="link small">Ver todos los casos</Link></p>
          )}
          {all && <p style={{ marginTop: 12 }}><Link href={hrefFor(offer.id, "casos")} className="link small">Ver menos</Link></p>}
        </>
      ) : (
        !data.toReview.length && (
          <p className="note">
            {nothing
              ? "Todavía no tiene casos de éxito para sugerir. Pega el enlace de donde los tienes y yo los leo."
              : "Todavía no hay casos confirmados."}
          </p>
        )
      )}

      {data.missing.length > 0 && (
        <p className="small muted" style={{ marginTop: 14 }}>
          Ya no aparecen en tu enlace: {data.missing.map((c) => caseFields(c).name || "sin nombre").join(", ")}. No los voy a sugerir.
        </p>
      )}

      {data.sources.length > 0 && (
        <>
          <h3 className="sub">De dónde los leo</h3>
          {data.sources.map((s) => (
            <div key={s.id} className="src">
              <div style={{ minWidth: 0 }}>
                <div className="u">
                  {KIND_TEXT[s.kind]}{s.title ? ` · ${s.title}` : ""}{" "}
                  <a href={s.rawUrl} target="_blank" rel="noreferrer" className="link small">abrir</a>
                </div>
                <div className="small muted">
                  {STATUS_TEXT[s.status]}
                  {s.status === "READY" && s.lastSyncedAt ? ` el ${shortDate(s.lastSyncedAt)}` : ""}
                  {s.lastError && s.status !== "READY" ? ` · ${s.lastError}` : ""}
                </div>
              </div>
              <form action={syncSourceAction}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="offerId" value={offer.id} />
                <Submit className="btn sec sm" pending="Leyendo…">{s.status === "PENDING" ? "Leer ahora" : "Leer de nuevo"}</Submit>
              </form>
            </div>
          ))}
        </>
      )}

      <h3 className="sub">Agregar enlaces</h3>
      <form action={addLinksAction} className="form">
        <input type="hidden" name="offerId" value={offer.id} />
        <label className="field">
          {youtube
            ? "Pega el enlace de una hoja de Google o de YouTube (una lista, un canal o videos). Uno por línea."
            : "Pega el enlace de una hoja de Google. Uno por línea."}
          <textarea name="links" required placeholder="https://docs.google.com/spreadsheets/d/…" style={{ minHeight: 70 }} />
        </label>
        <p className="small muted">
          La hoja debe estar compartida como «Cualquier persona con el enlace»{drive ? ", o elígela desde tu Drive" : ""}.
          {youtube ? " De YouTube leo solo el título y la descripción de cada video." : ""}
        </p>
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <span>
            {drive &&
              (drive.connected ? (
                <DrivePickerButton offerId={offer.id} apiKey={drive.apiKey} appId={drive.appId} />
              ) : (
                <a href={`/api/drive/connect?offer=${encodeURIComponent(offer.id)}`} className="btn sec sm">Conectar mi Drive</a>
              ))}
          </span>
          <Submit className={data.toReview.length ? "btn sec" : "btn pri"} pending="Leyendo…">Leer enlaces</Submit>
        </div>
      </form>

      <details style={{ marginTop: 18 }}>
        <summary className="link small">Agregar un caso a mano</summary>
        <form action={addManualCaseAction} className="form" style={{ marginTop: 12 }}>
          <input type="hidden" name="offerId" value={offer.id} />
          <div className="row">
            <label className="field">Quién es<input name="name" required maxLength={200} /></label>
            <label className="field">A qué se dedica<input name="profile" /></label>
            <label className="field">Cómo estaba antes<input name="before" /></label>
            <label className="field">Qué logró<input name="result" /></label>
          </div>
          <div className="row">
            <label className="field">Una frase suya (opcional)<input name="quote" /></label>
            <label className="field">Enlace al testimonio (opcional)<input name="mediaUrl" type="url" /></label>
          </div>
          <div className="actions"><Submit className="btn sec sm" pending="Guardando…">Agregar caso</Submit></div>
        </form>
      </details>
    </div>
  );
}
