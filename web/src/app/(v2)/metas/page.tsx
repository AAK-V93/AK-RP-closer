// Metas (mockups 09-metas, 09b-metas-movil, 09c-metas-vacio; README-rediseno.md).
// «¿Cómo llego a mi meta este mes?». Every number comes from lib/metrics.
import Link from "next/link";
import { metasView } from "@/lib/metrics";
import { getGoals, getOffers, getUserSettings } from "@/lib/read/cached";
import { requireUserId } from "@/lib/session";
import { bogotaDay } from "@/lib/time/bogota";
import { V2Nav } from "@/components/v2/nav";
import { IconCal, IconCheck, IconFlag, IconPeople } from "@/components/v2/icons";
import { monthName, monthTitle } from "@/lib/format/goal";
import { CaminoCard, GoalCard, GoalForm, NearCard, BlockerCard, NumbersCard, WeekCard } from "./parts";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MetasPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireUserId("/metas");
  const now = new Date();
  const today = bogotaDay(now);
  const settings = await getUserSettings(user.id);
  const [data, offers] = await Promise.all([getGoals(user.id, today, settings.currency), getOffers(user.id)]);
  const view = metasView(data, offers, settings.currency, now);
  const ok = one(sp.ok);
  const error = one(sp.error);
  const editing = one(sp.editar) === "1";
  const month = monthName(data.month);

  return (
    <>
      <V2Nav current="metas" name={user.name} email={user.email} />
      <div className="wrap metas">
        <div className="lbl">{monthTitle(data.month)}</div>
        <h1 className="page" style={{ marginTop: 6 }}>Metas</h1>
        {view.goal && (
          <div className="pagesub">Tu camino a la meta con tus números reales. Se recalcula cada vez que cierras o cambias la meta.</div>
        )}
        {ok && <div className="banner ok" role="status" style={{ marginTop: 16 }}>{ok}</div>}
        {error && <div className="banner err" role="alert" style={{ marginTop: 16 }}>{error}</div>}

        {!view.goal ? (
          <>
            <div className="card set">
              <div>
                <h2>Ponte una meta para este mes</h2>
                <div className="sub2">
                  Dime cuánta comisión quieres ganar en {month}. Con tus llamadas y tus ofertas te armo el camino para llegar.
                </div>
                <GoalForm
                  currency={settings.currency}
                  lastMonthEarnedCents={view.lastMonthEarnedCents}
                  prevMonth={data.prevMonth}
                  from="new"
                />
              </div>
              <div className="prev">
                <div className="k">Cuando la pongas, vas a ver</div>
                <ul>
                  <li><span className="n"><IconFlag /></span><span>Cuántos cierres te faltan y de qué oferta, con la comisión de cada una.</span></li>
                  <li><span className="n"><IconCal /></span><span>Cuántas reuniones necesitas, según tu ritmo real.</span></li>
                  <li><span className="n"><IconCheck /></span><span>Una meta chica para cada semana: reuniones y seguimientos.</span></li>
                  <li><span className="n"><IconPeople /></span><span>Las personas que más te acercan a la meta.</span></li>
                </ul>
              </div>
            </div>
            <div className="card ghost" aria-hidden>
              <div className="gt">Tu camino</div>
              <div className="gm"><span className="sk r" /><div><div className="sk" style={{ width: "60%" }} /><div className="sk thin" style={{ width: "40%" }} /></div><div className="sk" /></div>
              <div className="gm" style={{ opacity: 0.6 }}><span className="sk r" /><div><div className="sk" style={{ width: "75%" }} /><div className="sk thin" style={{ width: "45%" }} /></div><div className="sk" /></div>
            </div>
          </>
        ) : (
          <>
            {editing ? (
              <div className="card goal" style={{ marginTop: 22 }}>
                <div className="k"><span>Cambia tu meta de {month}</span><Link className="edit" href="/metas">Cancelar</Link></div>
                <GoalForm
                  currency={view.goal.currency}
                  lastMonthEarnedCents={view.lastMonthEarnedCents}
                  prevMonth={data.prevMonth}
                  from="edit"
                  initial={String(view.goal.targetCents / 100)}
                />
              </div>
            ) : (
              <GoalCard view={view} month={month} userCurrency={settings.currency} />
            )}
            <div className="two">
              <CaminoCard view={view} offers={offers} />
              <WeekCard view={view} week={data.week} today={today} editing={one(sp.semana) === "1"} />
            </div>
            <NumbersCard view={view} month={data.month} prevMonth={data.prevMonth} currency={settings.currency} />
            <div className="two2">
              <NearCard view={view} currency={settings.currency} />
              <BlockerCard view={view} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

