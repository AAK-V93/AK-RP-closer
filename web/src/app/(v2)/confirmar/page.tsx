// Llamadas por confirmar (mockup 04-confirmar-llamadas, README «Confirmar llamadas»).
// «¿Qué pasó en mis últimas llamadas?»: one tap per call, the suggested option
// has the black border, a saved card turns green with «Deshacer».
import Link from "next/link";
import { OUTCOMES, OUTCOME_LABEL, PENDING_PAYMENT_LABEL } from "@/lib/confirm/choice";
import { callMeta } from "@/lib/format/confirm";
import { initials } from "@/lib/format/goal";
import { showLink } from "@/lib/hidden-links";
import { confirmProgress } from "@/lib/metrics";
import { getPending } from "@/lib/read/cached";
import { readDealDefaults, readIgnored, readSaved } from "@/lib/read/confirm";
import type { PendingCall } from "@/lib/read/pending";
import { readCounters } from "@/lib/read/today";
import { getPrisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { bogotaDay } from "@/lib/time/bogota";
import { V2Nav } from "@/components/v2/nav";
import { Submit } from "@/components/v2/submit";
import { IconCal, IconCheck, IconChev, IconInfo, IconX } from "@/components/v2/icons";
import { confirmAction, recoverAction, undoAction } from "./actions";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DOT: Record<string, string> = { CERRO: "var(--green)", SEGUIMIENTO: "var(--amber)", PERDIDO: "var(--rose)" };

export default async function ConfirmarPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireUserId("/confirmar");
  const db = getPrisma();
  if (!db) throw new Error("DATABASE_URL no está configurada");
  const today = bogotaDay(new Date());
  const hechas = one(sp.hechas).split(",").filter(Boolean);
  const cerro = one(sp.cerro);
  const showIgnored = one(sp.ignoradas) === "1";
  const [pending, saved, counters] = await Promise.all([
    getPending(user.id),
    readSaved(db, user.id, hechas),
    readCounters(db, user.id),
  ]);
  const ignoredCount = counters?.ignoredCount ?? 0;
  const [ignored, defaults] = await Promise.all([
    showIgnored && ignoredCount > 0 ? readIgnored(db, user.id) : Promise.resolve([]),
    cerro && pending.some((c) => c.id === cerro) ? readDealDefaults(db, user.id, cerro) : Promise.resolve(null),
  ]);
  const progress = confirmProgress(saved.length, pending.length);
  const hechasParam = saved.map((s) => s.id).join(",");
  const ok = one(sp.ok);
  const error = one(sp.error);
  const ficha = showLink("confirmar.ficha");

  return (
    <>
      <V2Nav current="hoy" name={user.name} email={user.email} />
      <div className="wrap confirm">
        <div className="cp">
          <div className="hh">
            <div>
              <h1>Llamadas por confirmar</h1>
              <div className="sub">Yo escuché cada llamada. Toca lo que pasó; el borde negro es lo que yo entendí.</div>
            </div>
            <Link className="x" href="/" aria-label="Cerrar"><IconX /></Link>
          </div>
          {ok && <div className="banner ok" role="status">{ok}</div>}
          {error && <div className="banner err" role="alert">{error}</div>}
          {progress.total > 0 && (
            <div className="prog">
              <span>Llevas {progress.done} de {progress.total}</span>
              <span className="bar"><i style={{ width: `${Math.round(progress.ratio * 100)}%` }} /></span>
            </div>
          )}
          <div className="list">
            {saved.map((s) => (
              <div className="it done" key={s.id} id={`c-${s.id}`}>
                <div className="top">
                  <div className="av">{initials(s.name)}</div>
                  <div className="i">
                    <div className="nm">{s.name}</div>
                    <div className="meta">{callMeta(null, s.recordedAt, null, today)}</div>
                  </div>
                </div>
                <form action={undoAction} className="ok">
                  <IconCheck />{s.saved}
                  <input type="hidden" name="changeId" value={s.changeId} />
                  <input type="hidden" name="callId" value={s.id} />
                  <input type="hidden" name="hechas" value={hechasParam} />
                  <Submit className="link" pending="Deshaciendo…">Deshacer</Submit>
                </form>
              </div>
            ))}
            {pending.map((c) => (
              <PendingCard key={c.id} c={c} today={today} hechas={hechasParam} open={cerro === c.id}
                quien={one(sp.quien)} nombre={one(sp.nombre)} defaults={cerro === c.id ? defaults : null} ficha={ficha} />
            ))}
            {pending.length === 0 && (
              <div className="empty">
                {saved.length ? "Listo, confirmaste todas. Tus números ya están al día." : "No tienes llamadas por confirmar."}
              </div>
            )}
          </div>
          {ignoredCount > 0 && (
            <div className="ign">
              <Link className="ignh" href={showIgnored ? `/confirmar?hechas=${hechasParam}` : `/confirmar?hechas=${hechasParam}&ignoradas=1#ignoradas`} id="ignoradas">
                <IconChev />Ignoradas ({ignoredCount})
              </Link>
              {showIgnored && (
                <>
                  <div className="ignsub">Las aparté porque parecían internas. Si una era con un cliente, tráela de vuelta.</div>
                  {ignored.map((g) => (
                    <div className="ig" key={g.id} id={`c-${g.id}`}>
                      <div className="i">
                        <div className="nm">{g.title}</div>
                        <div className="meta">{callMeta(null, g.recordedAt, g.durationSec, today)}</div>
                        {g.oneLine && <div className="q">{g.oneLine}</div>}
                      </div>
                      <form action={recoverAction}>
                        <input type="hidden" name="callId" value={g.id} />
                        <input type="hidden" name="hechas" value={hechasParam} />
                        <Submit className="btn sec sm" pending="Trayendo…">No era interna</Submit>
                      </form>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {ficha && pending.length > 0 && (
            <div className="ft"><IconInfo />Toca › para ver el resumen completo en la ficha de la persona.</div>
          )}
        </div>
      </div>
    </>
  );
}

function cardName(c: PendingCall) {
  if (c.who.kind === "lead" || c.who.kind === "new") return c.who.name;
  if (c.who.kind === "pick" && c.who.name) return c.who.name;
  return c.title;
}

function PendingCard({ c, today, hechas, open, quien, nombre, defaults, ficha }: {
  c: PendingCall; today: string; hechas: string; open: boolean; quien: string; nombre: string; ficha: boolean;
  defaults: { amountTotal: number | null; cashCollected: number | null; paymentMode: "CONTADO" | "CUOTAS" | null } | null;
}) {
  const name = cardName(c);
  return (
    <div className="it" id={`c-${c.id}`}>
      <div className="top">
        <div className="av">{initials(name)}</div>
        <div className="i">
          <div className="nm">{name}</div>
          <div className="meta">{callMeta(c.offerName, c.recordedAt, c.durationSec, today)}</div>
        </div>
        {ficha && c.who.kind === "lead" && (
          <Link className="chev" href={`/personas/${c.who.leadId}`} aria-label={`Ver la ficha de ${name}`}><IconChev /></Link>
        )}
      </div>
      {c.pendingPayment && <span className="pill amber pp">{PENDING_PAYMENT_LABEL}</span>}
      {c.oneLine && <div className="q">{c.oneLine}</div>}
      <form action={confirmAction}>
        <input type="hidden" name="callId" value={c.id} />
        <input type="hidden" name="version" value={c.version} />
        <input type="hidden" name="hechas" value={hechas} />
        {open ? (
          <>
            <input type="hidden" name="step" value="deal" />
            <input type="hidden" name="outcome" value="CERRO" />
            <input type="hidden" name="who" value={quien} />
            <input type="hidden" name="name" value={nombre} />
            <div className="deal">
              <div className="dq">¡Bien! ¿Cuánto fue la venta?</div>
              <label>Monto total<input name="amountTotal" inputMode="decimal" defaultValue={defaults?.amountTotal ?? ""} placeholder="No sé todavía" /></label>
              <label>Cobrado hoy<input name="cashCollected" inputMode="decimal" defaultValue={defaults?.cashCollected ?? ""} placeholder="No sé todavía" /></label>
              <div className="modes" role="radiogroup" aria-label="Forma de pago">
                <label className="chipf"><input type="radio" name="paymentMode" value="CONTADO" defaultChecked={defaults?.paymentMode === "CONTADO"} />De contado</label>
                <label className="chipf"><input type="radio" name="paymentMode" value="CUOTAS" defaultChecked={defaults?.paymentMode === "CUOTAS"} />En cuotas</label>
                <label className="chipf"><input type="radio" name="paymentMode" value="" defaultChecked={!defaults?.paymentMode} />No sé todavía</label>
              </div>
              <div className="dn">Si no sabes el monto, déjalo vacío: queda «por confirmar».</div>
              <div className="da">
                <Submit className="btn pri sm" pending="Guardando…">Guardar venta</Submit>
                <Link className="btn sec sm" href={`/confirmar?hechas=${hechas}#c-${c.id}`}>Cancelar</Link>
              </div>
            </div>
          </>
        ) : (
          <>
            {c.who.kind === "pick" && (
              <div className="who" role="radiogroup" aria-label="¿Quién es?">
                <div className="wq">¿Quién es? Se parece a alguien que ya tienes.</div>
                {c.who.candidates.map((p) => (
                  <label className="chipf" key={p.id}><input type="radio" name="who" value={`lead:${p.id}`} required />{p.name}</label>
                ))}
                <label className="chipf"><input type="radio" name="who" value="new" required />Es otra persona{c.who.name ? `: ${c.who.name}` : ""}</label>
              </div>
            )}
            {c.who.kind === "ask" && (
              <div className="who">
                <input type="hidden" name="who" value="new" />
                <label className="wq">¿Cómo se llama esta persona?<input name="name" required maxLength={120} /></label>
              </div>
            )}
            <div className="ch">
              {OUTCOMES.map((o) => (
                <button key={o} type="submit" name="outcome" value={o} className={c.suggestedOutcome === o ? "opt sug" : "opt"}>
                  {o === "REAGENDAR" ? <IconCal /> : <span className="dot" style={{ color: DOT[o] }} />}
                  {OUTCOME_LABEL[o]}
                </button>
              ))}
            </div>
          </>
        )}
      </form>
    </div>
  );
}
