// Hoy. PR 4 brings step 1 of «Empieza en 3 pasos» (mockup 01b-hoy-vacio)
// and the goal summary; the list «A quién escribirle hoy» arrives with Hoy (PR 5).
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { goalProgress, toCents } from "@/lib/metrics";
import { getStartSteps, getTodayHeader, getUserSettings } from "@/lib/read/cached";
import { bogotaDay } from "@/lib/time/bogota";
import { formatCents } from "@/lib/format/money";
import { daysText, monthName } from "@/lib/format/goal";
import { V2Nav } from "@/components/v2/nav";
import { IconCheck, IconChev, IconFlag, IconPhone, IconUpload } from "@/components/v2/icons";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function dayTitle(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${Number(day.slice(8, 10))} de ${monthName(day)}`;
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return <SignedOut />;

  const now = new Date();
  const today = bogotaDay(now);
  const [steps, header, settings] = await Promise.all([
    getStartSteps(userId, today),
    getTodayHeader(userId, today),
    getUserSettings(userId),
  ]);
  const done = [Boolean(steps.goal), steps.hasOffer, steps.hasCall];
  const doneCount = done.filter(Boolean).length;
  const current = done.findIndex((d) => !d);
  const cls = (i: number) => (done[i] ? "st done" : i === current ? "st now" : "st");
  const goal = steps.goal;
  const progress = goal
    ? goalProgress(
        toCents(goal.targetCommission) ?? 0,
        goal.currency === settings.currency ? (toCents(header.stats?.commissionEarned) ?? 0) : 0,
        now,
      )
    : null;
  const money = (c: number) => formatCents(c, goal?.currency ?? settings.currency);

  return (
    <>
      <V2Nav current="hoy" name={session.user?.name ?? null} email={session.user?.email ?? null} />
      <div className="wrap hoy">
        <div className="lbl">{dayTitle(today)}</div>
        <h1 className="page" style={{ marginTop: 6 }}>{doneCount < 3 ? "Te damos la bienvenida" : "Hoy"}</h1>
        {doneCount < 3 && (
          <div className="pagesub">En unos minutos la app sabrá a quién escribirle y cómo vas con tu meta. Tú solo dale lo básico.</div>
        )}

        {goal && progress && (
          <div className="card pad hgoal">
            <div>
              <div className="lbl">Tu meta de {monthName(today)}</div>
              <div className="hv">{money(progress.earned)} <small>de {money(progress.target)}</small></div>
              <div className="bar"><i style={{ width: `${Math.round(progress.ratio * 100)}%` }} /></div>
              <div className="hs">
                {goal.currency !== settings.currency
                  ? `Lo que llevas queda por confirmar · ${daysText(progress.daysLeft)}`
                  : progress.done
                    ? `Llegaste a tu meta · ${daysText(progress.daysLeft)}`
                    : `Te faltan ${money(progress.remaining)} · ${daysText(progress.daysLeft)}`}
              </div>
            </div>
            <Link className="link" href="/metas">Ver mi camino <IconChev /></Link>
          </div>
        )}

        {doneCount < 3 && (
          <div className="card start">
            <div className="h">
              <div>
                <h2>Empieza en 3 pasos</h2>
                <div className="sub2">Lo demás lo hago yo: resumo tus llamadas, cuento tus seguimientos y te propongo mensajes.</div>
              </div>
              <div className="prog">
                <div className="t">{doneCount === 0 ? "Te faltan 3" : `Ya hiciste ${doneCount} · te ${3 - doneCount === 1 ? "falta 1" : `faltan ${3 - doneCount}`}`}</div>
                <div className="bar"><i style={{ width: `${Math.round((doneCount / 3) * 100)}%` }} /></div>
              </div>
            </div>
            <div className="steps">
              <div className={cls(0)}>
                <span className="n">{done[0] ? <IconCheck /> : 1}</span>
                <h3>Ponte una meta</h3>
                <p>Cuánta comisión quieres ganar este mes.</p>
                <div className="r">
                  {goal ? (
                    <><IconCheck />{formatCents(toCents(goal.targetCommission), goal.currency)} en {monthName(today)}</>
                  ) : (
                    <Link className={`btn ${current === 0 ? "pri" : "sec"}`} href="/metas"><IconFlag />Poner mi meta</Link>
                  )}
                </div>
              </div>
              <div className={cls(1)}>
                <span className="n">{done[1] ? <IconCheck /> : 2}</span>
                <h3>Sube tu oferta</h3>
                <p>Pega el texto o sube el PDF. Yo saco los precios, las cuotas y tu comisión.</p>
                <div className="r">
                  {steps.hasOffer ? (
                    <><IconCheck />Ya tienes tu oferta</>
                  ) : (
                    <Link className={`btn ${current === 1 ? "pri" : "sec"}`} href="/ofertas?nueva=1"><IconUpload />Subir oferta</Link>
                  )}
                </div>
              </div>
              <div className={cls(2)}>
                <span className="n">{done[2] ? <IconCheck /> : 3}</span>
                <h3>Trae tu primera llamada</h3>
                <p>Conecta Fathom o sube una grabación. Con eso armo tu lista de seguimientos.</p>
                <div className="r">
                  {steps.hasCall ? (
                    <><IconCheck />Ya llegó tu primera llamada</>
                  ) : (
                    <span className="pill grey"><IconPhone />Muy pronto en esta versión</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!steps.hasCall && (
        <div className="card hghost">
          <div className="gh"><span className="t">A quién escribirle hoy</span><span className="pill grey">Aparece con tu primera llamada</span></div>
          <div className="gr"><div className="av" /><div><div className="sk" style={{ width: 130 }} /><div className="sk thin" style={{ width: 90 }} /></div><div className="sk" style={{ width: "80%" }} /></div>
          <div className="gr" style={{ opacity: 0.4 }}><div className="av" /><div><div className="sk" style={{ width: 110 }} /><div className="sk thin" style={{ width: 80 }} /></div><div className="sk" style={{ width: "65%" }} /></div>
          <div className="gnote">Aquí verás a cada persona con lo que quedó pendiente y un mensaje listo para mandarle.</div>
        </div>
        )}
      </div>
    </>
  );
}

function SignedOut() {
  return (
    <div className="wrap" style={{ maxWidth: 560, paddingTop: 80 }}>
      <div className="brand" style={{ width: "auto" }}>Closer Trainer</div>
      <div className="card pad" style={{ marginTop: 24 }}>
        <h1 className="page" style={{ fontSize: 30 }}>Entrena con tus llamadas reales</h1>
        <p className="pagesub" style={{ fontSize: 15.5 }}>Practica tus cierres, sigue a cada persona y llega a tu meta del mes.</p>
        <div style={{ marginTop: 20 }}><Link className="btn pri" href="/login?callbackUrl=/">Entrar</Link></div>
      </div>
    </div>
  );
}
