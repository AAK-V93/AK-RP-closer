// Metas blocks. Server components; choices are plain forms (no client JS).
import Link from "next/link";
import type { DayKey } from "@/lib/time/bogota";
import { showLink } from "@/lib/hidden-links";
import { type metasView, goalIdeas, missingPerCloseLabel, pathKey, pathMissingLabel } from "@/lib/metrics";
import type { Compared } from "@/lib/metrics";
import { formatCents } from "@/lib/format/money";
import {
  daysText,
  initials,
  monthName,
  monthShort,
  pathDetail,
  pathPhrase,
  pathTitle,
  plural,
  rateText,
  trendText,
  weekLabel,
} from "@/lib/format/goal";
import { IconInfo, IconPen } from "@/components/v2/icons";
import { Submit } from "@/components/v2/submit";
import { choosePathAction, setGoalAction, setWeekAction } from "./actions";

type View = ReturnType<typeof metasView>;
type Offer = { id: string; name: string; currency: string };

const offerHref = (id: string, tab: "precios" | "comision") => `/ofertas?oferta=${encodeURIComponent(id)}&tab=${tab}&editar=1`;

export function GoalForm({
  currency,
  lastMonthEarnedCents,
  prevMonth,
  from,
  initial = "",
}: {
  currency: string;
  lastMonthEarnedCents: number | null;
  prevMonth: DayKey;
  from: "new" | "edit";
  initial?: string;
}) {
  // ideas only from her own last month (same, +20 %, +50 %), in her currency; none without history
  const ideas = goalIdeas(lastMonthEarnedCents);
  return (
    <form action={setGoalAction}>
      <input type="hidden" name="from" value={from} />
      <div className="inp">
        <label className="box">
          <span className="u">{currency}</span>
          <input name="amount" inputMode="decimal" autoComplete="off" defaultValue={initial} aria-label="Comisión que quieres ganar este mes" placeholder="0" />
        </label>
        <span className="lab">de comisión</span>
      </div>
      {lastMonthEarnedCents !== null && ideas.length > 0 && (
        <div className="quick">
          <span className="lb">En {monthName(prevMonth)} ganaste {formatCents(lastMonthEarnedCents, currency)}. Ideas:</span>
          {ideas.map((idea) => (
            <button key={idea.cents} type="submit" name="idea" value={String(idea.cents / 100)} className="chipf">
              {formatCents(idea.cents, currency)}{idea.label === "igual" ? " (lo mismo)" : ` (${idea.label})`}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Submit className="btn pri big" pending="Calculando…">{from === "edit" ? "Guardar y recalcular" : "Calcular mi camino"}</Submit>
      </div>
      <div className="n">La puedes cambiar cuando quieras durante el mes.</div>
    </form>
  );
}

export function GoalCard({ view, month, userCurrency }: { view: View; month: string; userCurrency: string }) {
  const g = view.goal!;
  const p = g.progress;
  const money = (c: number) => formatCents(c, g.currency);
  return (
    <div className="card goal" style={{ marginTop: 22 }}>
      <div className="k">
        <span>Tu meta de {month}</span>
        <Link className="edit" href="/metas?editar=1"><IconPen />Editar</Link>
      </div>
      <div className="v">{money(g.targetCents)} <small>de comisión</small></div>
      <div className="bar"><i style={{ width: `${Math.round(p.ratio * 100)}%` }} /></div>
      {g.earnedUnknown ? (
        <div className="s">
          Tu meta está en {g.currency} y tus ventas se suman en {userCurrency}: lo que llevas queda por confirmar · <b>{daysText(p.daysLeft)}</b>
        </div>
      ) : p.done ? (
        <div className="s">Llegaste a tu meta: llevas <b>{money(p.earned)}</b> · <b>{daysText(p.daysLeft)}</b></div>
      ) : (
        <div className="s">
          Llevas <b>{money(p.earned)}</b> · te faltan <b>{money(p.remaining)}</b> · {p.daysLeft === 1 ? "queda" : "quedan"} <b>{p.daysLeft === 1 ? "1 día" : `${p.daysLeft} días`}</b>
        </div>
      )}
      <div className="n">Puedes cambiarla cuando quieras durante el mes; tu camino se recalcula al momento.</div>
    </div>
  );
}

export function CaminoCard({ view, offers }: { view: View; offers: Array<Offer & { priceCash: string | null; commissionType: string | null; commissionValue: string | null }> }) {
  const g = view.goal!;
  const perClose = new Map(g.paths.flatMap((p) => p.closes.map((c) => [c.offerId, null] as [string, number | null])));
  // per-close commission of each offer, for the detail line
  for (const o of view.numbers.offers) if (o.perClose.cents !== null) perClose.set(o.id, o.perClose.cents);
  const currency = g.currency;
  const shortest = g.paths.length
    ? g.paths.reduce((best, p, i) => (total(p) < total(g.paths[best]) ? i : best), 0)
    : null;
  const sums = new Set(g.paths.map((p) => p.commissionCents));
  const offerCurrency = new Map(offers.map((o) => [o.id, o.currency]));

  return (
    <div className="card pad camino">
      <div className="ch">Tu camino</div>
      {g.progress.done ? (
        <div className="intro">Ya llegaste a tu meta de este mes. Si quieres ir por más, súbela con «Editar».</div>
      ) : offers.length === 0 ? (
        <>
          <div className="intro">Todavía no hay ofertas. Sube tu oferta con tu comisión y te armo el camino.</div>
          <div style={{ marginTop: 14 }}><Link className="btn pri sm" href="/ofertas?nueva=1">Subir oferta</Link></div>
        </>
      ) : g.paths.length === 0 ? (
        <div className="intro">Para armar tu camino necesito saber cuánto ganas por cierre en al menos una oferta.</div>
      ) : (
        <>
          <div className="intro">
            {view.pace !== null ? <>Con tu ritmo actual (<b>cierras 1 de cada {view.pace} reuniones</b>) necesitas </> : <>Necesitas </>}
            <b>{pathPhrase(g.paths[0])}</b>
            {g.paths[1] && <>, o {pathPhrase(g.paths[1])}</>}. Elige el que prefieras:
          </div>
          {g.paths.map((p, i) => {
            const on = g.chosenIndex === i;
            return (
              <form key={pathKey(p)} action={choosePathAction}>
                <input type="hidden" name="path" value={pathKey(p)} />
                <button type="submit" className={`mix${on ? " on" : ""}`} aria-pressed={on}>
                  <span className="r" />
                  <div>
                    <div className="t">
                      {pathTitle(p)}
                      {shortest === i && g.paths.length > 1 && <span className="pill green">El más corto</span>}
                    </div>
                    <div className="d">{pathDetail(p, perClose, currency)}</div>
                  </div>
                  <div className="m">
                    {p.meetings !== null ? <><b>≈ {p.meetings}</b><span>reuniones</span></> : <><span>reuniones:</span><span>por confirmar</span></>}
                  </div>
                </button>
              </form>
            );
          })}
          <div className="foot">
            <IconInfo />
            <span>
              {sums.size === 1 ? `Cada camino suma ${formatCents(g.paths[0].commissionCents, currency)}. ` : "Cada camino suma lo que te falta o un poco más. "}
              {view.pace !== null
                ? `Las reuniones salen de tu ritmo real: cierras 1 de cada ${view.pace} reuniones (este mes y el anterior).`
                : "Las reuniones quedan por confirmar hasta que tengas al menos 3 personas que decidieron (cerraron o no) y un cierre."}
            </span>
          </div>
        </>
      )}
      {!g.progress.done &&
        g.missing.map((m) => (
          <div className="fix" key={m.offerId}>
            <span>{pathMissingLabel(m.reason, m.offerName, offerCurrency.get(m.offerId) ?? currency, currency)}</span>
            {m.reason !== "CURRENCY" && (
              <Link className="btn sm fixit" href={offerHref(m.offerId, m.reason === "PRICE" ? "precios" : "comision")}>Completar</Link>
            )}
          </div>
        ))}
    </div>
  );
}

const total = (p: { closes: Array<{ count: number }> }) => p.closes.reduce((n, c) => n + c.count, 0);

const DOTS_MAX = 24;
function Dots({ done, target }: { done: number; target: number }) {
  if (target <= 0 || target > DOTS_MAX) return null;
  return (
    <div className="big-dots" aria-hidden>
      {Array.from({ length: target }, (_, i) => <i key={i} className={i < done ? "f" : undefined} />)}
    </div>
  );
}

export function WeekCard({ view, week, today, editing }: { view: View; week: DayKey; today: DayKey; editing: boolean }) {
  const w = view.week;
  const saved = w.meetings.target !== null && w.attempts.target !== null;
  const showForm = !saved || editing;
  const left: string[] = [];
  if (w.meetingsLeft) left.push(plural(w.meetingsLeft, "reunión", "reuniones"));
  if (w.attemptsLeft) left.push(plural(w.attemptsLeft, "seguimiento", "seguimientos"));
  const chosen = view.chosen;
  return (
    <div className="card pad wk">
      <div className="ch">Esta semana</div>
      <div className="cs">{weekLabel(week, today)}</div>
      <div className="row">
        <div className="l"><span>Reuniones</span><b>{saved ? `${w.meetings.done} de ${w.meetings.target}` : w.meetings.done}</b></div>
        {saved && <Dots done={w.meetings.done} target={w.meetings.target!} />}
      </div>
      <div className="row">
        <div className="l"><span>Seguimientos</span><b>{saved ? `${w.attempts.done} de ${w.attempts.target}` : w.attempts.done}</b></div>
        {saved && <Dots done={w.attempts.done} target={w.attempts.target!} />}
      </div>
      {saved && !editing && (
        <div className="note">
          {left.length ? `Te faltan ${left.join(" y ")}.` : "Cumpliste tu meta de esta semana."}
          {chosen && ` Tu camino elegido: ${pathTitle(chosen)}.`}
          <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Link className="link" href="/metas?semana=1">Cambiar la meta de la semana</Link>
            {showLink("metas.semana.a-quien-escribir") && <Link className="link" href="/personas?tab=seguimiento">Ver a quién escribirle</Link>}
          </div>
        </div>
      )}
      {showForm && (
        <form action={setWeekAction} className="note form">
          <div>
            {w.suggestion.meetings !== null && !saved
              ? `Te sugiero ≈ ${plural(w.suggestion.meetings, "reunión", "reuniones")}: sale de tu camino elegido repartido en las semanas que quedan del mes, contando esta. Cámbialo si quieres.`
              : !chosen && !saved
                ? "Pon cuántas reuniones y seguimientos quieres hacer esta semana. Si eliges un camino, te sugiero las reuniones."
                : !saved
                  ? "Todavía no sé tu ritmo para sugerirte reuniones: pon las tuyas."
                  : "Cambia tu meta de esta semana."}
          </div>
          <div className="row">
            <label className="field">
              <span>Reuniones {w.suggestion.meetings !== null && !saved && <span className="pill amber sug">sugerido</span>}</span>
              <input name="meetingsTarget" inputMode="numeric" defaultValue={w.suggestion.meetings ?? ""} className={w.suggestion.meetings !== null && !saved ? "suggested" : undefined} />
            </label>
            <label className="field">
              <span>Seguimientos</span>
              <input name="followupsTarget" inputMode="numeric" defaultValue={w.suggestion.followups ?? ""} />
            </label>
          </div>
          {w.followupsHint && (
            <div className="small muted">
              {w.followupsHint.people === 1
                ? "Para llevar a tu persona en seguimiento"
                : `Para llevar a tus ${w.followupsHint.people} personas`}{" "}
              a 6 intentos en 3 semanas: unos {w.followupsHint.perWeek} por semana.
            </div>
          )}
          <div className="actions">
            <Submit className="btn pri sm" pending="Guardando…">Guardar mi semana</Submit>
            {editing && <Link className="link" href="/metas">Cancelar</Link>}
          </div>
        </form>
      )}
    </div>
  );
}

function Cell({ label, value, c, prevMonth, firstMonth }: { label: string; value: string; c: Compared<unknown> & { prevText: string | null }; prevMonth: DayKey; firstMonth: boolean }) {
  const line = firstMonth ? null : trendText(c.trend, c.prevText, prevMonth);
  return (
    <div className="c">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
      {line && <div className={`p${c.better === true ? " up" : c.better === false ? " dn" : ""}`}>{line}</div>}
    </div>
  );
}

function NumbersRow({ title, small, cmp, prevMonth, firstMonth }: { title: string; small?: string | null; cmp: View["numbers"]["all"]; prevMonth: DayKey; firstMonth: boolean }) {
  const n = (c: Compared<number>) => ({ ...c, prevText: c.previous === null ? null : String(c.previous) });
  return (
    <div className="g">
      <div className="c o">{title}{small && <small>{small}</small>}</div>
      <Cell label="llamadas" value={String(cmp.calls.value)} c={n(cmp.calls)} prevMonth={prevMonth} firstMonth={firstMonth} />
      <Cell label="cerrados" value={String(cmp.closed.value)} c={n(cmp.closed)} prevMonth={prevMonth} firstMonth={firstMonth} />
      <Cell label="perdidos" value={String(cmp.lost.value)} c={n(cmp.lost)} prevMonth={prevMonth} firstMonth={firstMonth} />
      <Cell
        label="ganas"
        value={rateText(cmp.winRate.value)}
        c={{ ...cmp.winRate, prevText: cmp.winRate.previous ? rateText(cmp.winRate.previous) : null }}
        prevMonth={prevMonth}
        firstMonth={firstMonth}
      />
    </div>
  );
}

export function NumbersCard({ view, month, prevMonth, currency }: { view: View; month: DayKey; prevMonth: DayKey; currency: string }) {
  const n = view.numbers;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <>
      <div className="sechead">
        <h2 className="sec">Tus números</h2>
        <span className="aside">
          {n.firstMonth ? `${cap(monthName(month))} · primer mes` : `${cap(monthName(month))} comparado con ${monthName(prevMonth)}`}
        </span>
      </div>
      <div className="card pad nums">
        {!n.hasData ? (
          <div className="muted">Todavía no hay llamadas en {monthName(month)}. Tus números aparecen cuando confirmes la primera.</div>
        ) : (
          <>
            <div className="g head">
              <span className="h" />
              <span className="h">Llamadas</span>
              <span className="h">Cerrados</span>
              <span className="h">Perdidos</span>
              <span className="h">Ganas, de los que deciden</span>
            </div>
            <NumbersRow title="Todas las ofertas" cmp={n.all} prevMonth={prevMonth} firstMonth={n.firstMonth} />
            {n.offers.filter((o) => o.active).map((o) => (
              <NumbersRow
                key={o.id}
                title={o.name}
                small={
                  o.perClose.cents !== null
                    ? o.currency === currency
                      ? `${formatCents(o.perClose.cents, o.currency)} por cierre`
                      : `${formatCents(o.perClose.cents, o.currency)} por cierre · otra moneda`
                    : missingPerCloseLabel(o.perClose.missing, "esta oferta")
                }
                cmp={o.compare}
                prevMonth={prevMonth}
                firstMonth={n.firstMonth}
              />
            ))}
            {!n.firstMonth && <div className="cs" style={{ marginTop: 10 }}>Las flechas comparan con {monthShort(prevMonth)}; en verde lo que mejoró.</div>}
          </>
        )}
      </div>
    </>
  );
}

export function NearCard({ view, currency }: { view: View; currency: string }) {
  return (
    <div>
      <div className="sechead"><h2 className="sec">Lo que más te acerca</h2><span className="aside">Por comisión en juego</span></div>
      <div className="card list near">
        {view.near.length === 0 ? (
          <div className="pad muted">Todavía no hay personas en seguimiento con comisión en juego.</div>
        ) : (
          view.near.map((l) => (
            <div className="prow" key={l.id}>
              <div className="av">{initials(l.name)}</div>
              <div>
                <div className="nm">{l.name}</div>
                <div className="of">{[l.oneLine, `Seguimiento ${l.followUp.count} de ${l.followUp.max}`].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="mo">{formatCents(l.potentialCents, currency)}<small>comisión</small></div>
              {showLink("metas.cerca.ficha") && <Link className="link" href={`/personas/${l.id}`} aria-label={`Ver a ${l.name}`}>›</Link>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function BlockerCard({ view }: { view: View }) {
  const b = view.blocker;
  return (
    <div>
      <div className="sechead"><h2 className="sec">Lo que más te frena</h2></div>
      <div className="card pad frena">
        {b ? (
          <>
            <div className="lbl">De tus llamadas que no cerraron</div>
            <div className="t">Pierdes cierres cuando te dicen «{b.label}»</div>
            <div className="w">Pasó en {b.hits} de tus {b.of} últimas llamadas que no cerraron.</div>
            {showLink("metas.frena.practicar") && (
              <Link className="btn sec sm" href={`/practicar?objecion=${encodeURIComponent(b.label)}`}>Practicarlo</Link>
            )}
          </>
        ) : (
          <div className="muted">
            Todavía no hay suficientes llamadas que no cerraron para saberlo. Aparece cuando tengas al menos 3.
          </div>
        )}
      </div>
    </div>
  );
}

