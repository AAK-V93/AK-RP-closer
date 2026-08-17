"use client";

import Link from "next/link";
import type {
  QcBlockNote,
  QcCallReport,
} from "@/data/qc-report";

function Section({
  kicker,
  title,
  children,
}: {
  kicker?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      {kicker && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg3">
          {kicker}
        </p>
      )}
      <h2 className="text-lg font-light">{title}</h2>
      {children}
    </section>
  );
}

function Block({
  title,
  note,
}: {
  title: string;
  note: QcBlockNote;
}) {
  return (
    <div className="rounded-xl border border-separator1 bg-bg0 p-4 space-y-2 text-sm">
      <p className="font-medium">{title}</p>
      {note.whatHappened && (
        <p>
          <span className="text-fg3">Qué pasó. </span>
          {note.whatHappened}
        </p>
      )}
      {note.whatScriptAsked && (
        <p>
          <span className="text-fg3">Qué pedía el guion. </span>
          {note.whatScriptAsked}
        </p>
      )}
      {note.feedback && (
        <p>
          <span className="text-fg3">Feedback. </span>
          {note.feedback}
        </p>
      )}
      {note.missingQuestion && (
        <p className="italic text-fg2">
          La pregunta que faltó: {note.missingQuestion}
        </p>
      )}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  if (!items?.length) return null;
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-fg2">
      {items.filter(Boolean).map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function QcReportView({
  report,
  authenticated,
}: {
  report: QcCallReport;
  authenticated?: boolean;
}) {
  const q = report.prospectFile.qualification;
  const notes = report.prospectNotes;

  return (
    <div className="space-y-10 text-fg1">
      <header className="space-y-2 border-b border-separator1 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fg3">
          Reporte de la llamada
        </p>
        <h1 className="text-2xl font-light">{report.headline}</h1>
        <div className="flex flex-wrap items-baseline gap-4 pt-2">
          <p>
            <span className="text-3xl font-light">{Math.round(report.overallScore)}</span>
            <span className="text-sm text-fg3"> / 100</span>
          </p>
          <p className="text-sm text-fg3">
            {report.sold ? "Venta" : "Sin venta"}
            {report.commitment ? ` · ${report.commitment}` : ""}
            {report.durationMinutes
              ? ` · ${report.durationMinutes} min`
              : ""}
          </p>
        </div>
        {report.saved ? (
          <p className="text-xs text-fg3">
            Guardado en{" "}
            <Link href="/coach" className="underline">
              tu coaching
            </Link>
            .
          </p>
        ) : !authenticated ? (
          <p className="text-xs text-fg3">
            Esta fue tu auditoría gratis. Para la siguiente,{" "}
            <Link
              href="/login?mode=register&reason=qc-used&callbackUrl=/reporte"
              className="underline"
            >
              crea una cuenta
            </Link>
            .
          </p>
        ) : null}
      </header>

      <Section kicker="Ficha" title="Prospecto">
        <div className="space-y-4 text-sm">
          <p>
            <span className="text-fg3">Demográfico. </span>
            {report.prospectFile.demographic}
          </p>
          <p>
            <span className="text-fg3">Psicográfico. </span>
            {report.prospectFile.psychographic}
          </p>
          <div className="rounded-xl border border-separator1 bg-bg0 p-4 space-y-2">
            <p className="font-medium">Calificación — qué habilitaba la venta</p>
            <p><span className="text-fg3">Problema: </span>{q.problemCost}</p>
            <p><span className="text-fg3">Intentos previos: </span>{q.priorAttempts}</p>
            {q.moneyAlreadySpent && (
              <p><span className="text-fg3">Dinero ya gastado: </span>{q.moneyAlreadySpent}</p>
            )}
            <p><span className="text-fg3">Urgencia propia: </span>{q.ownUrgency}</p>
            <p><span className="text-fg3">Quién decide: </span>{q.decisionAuthority}</p>
            <p><span className="text-fg3">Encaje con la oferta: </span>{q.offerFit}</p>
          </div>
          <p>
            <span className="text-fg3">Capacidad de pago. </span>
            {report.prospectFile.paymentCapacity}
          </p>
          <p>
            <span className="text-fg3">Cómo entraba el programa. </span>
            {report.prospectFile.howOfferEntered}
          </p>
          <p>
            <span className="text-fg3">Marco de dinero. </span>
            {report.prospectFile.moneyFrame}
          </p>
          <p className="font-medium">
            Veredicto. {report.prospectFile.paymentVerdict}
          </p>
        </div>
      </Section>

      <Section kicker="Descubrimiento" title={`Nota del bloque, ${report.discovery.blockScore}/10`}>
        <p className="text-sm text-fg2">
          {report.discovery.discoveryPercent}% de la llamada ocupó el descubrimiento,
          contra un {report.discovery.pitchPercent}% de pitch y gestión de objeciones.
        </p>
        <Block title="Rapport y acuerdo de decisión" note={report.discovery.rapport} />
        <Block title="Problema y dolor" note={report.discovery.problemPain} />
        <Block title="Solución — esfuerzos actuales y pasados" note={report.discovery.pastSolutions} />
        <Block title="Situación deseada" note={report.discovery.desiredSituation} />
      </Section>

      <Section kicker="Pitch" title={`Nota del bloque, ${report.pitch.blockScore}/10`}>
        <p className="text-sm">{report.pitch.summary}</p>
      </Section>

      <Section kicker="Objeciones" title="Cómo se gestionaron">
        <div className="space-y-4">
          {report.objections.map((obj, index) => (
            <div
              key={`${obj.title}-${index}`}
              className="rounded-xl border border-separator1 bg-bg0 p-4 space-y-2 text-sm"
            >
              <p className="font-medium">
                Objeción {index + 1}. {obj.title}
              </p>
              <p className="italic text-fg2">
                «{obj.quote}»{obj.timestamp ? ` (${obj.timestamp})` : ""}
              </p>
              <p><span className="text-fg3">Categoría. </span>{obj.category}</p>
              <p><span className="text-fg3">Raíz real. </span>{obj.realRoot}</p>
              <p><span className="text-fg3">Cómo se gestionó. </span>{obj.howHandled}</p>
              <p><span className="text-fg3">Por qué falló o funcionó. </span>{obj.whyFailedOrWorked}</p>
              {obj.principle && (
                <p><span className="text-fg3">Principio. </span>{obj.principle}</p>
              )}
              {obj.suggestedLine && (
                <p className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <span className="text-fg3">Frase sugerida. </span>
                  {obj.suggestedLine}
                </p>
              )}
              {obj.prevention && (
                <p><span className="text-fg3">Prevención. </span>{obj.prevention}</p>
              )}
            </div>
          ))}
        </div>
        {report.rootObjection && (
          <p className="text-sm">
            <span className="text-fg3">Objeción raíz. </span>
            {report.rootObjection}
          </p>
        )}
        {report.missingAgreements.length > 0 && (
          <div className="text-sm space-y-1">
            <p className="text-fg3">Acuerdos que faltaron</p>
            <List items={report.missingAgreements} />
          </div>
        )}
      </Section>

      <Section kicker="Huecos" title="Fallas de descubrimiento que alimentaron las objeciones">
        <div className="space-y-4">
          {report.discoveryFailures.map((fail, index) => (
            <div
              key={`${fail.title}-${index}`}
              className="rounded-xl border border-separator1 bg-bg0 p-4 space-y-2 text-sm"
            >
              <p className="font-medium">
                Falla {index + 1}. {fail.title}
              </p>
              <p><span className="text-fg3">Qué se perdió. </span>{fail.whatWasMissed}</p>
              <p><span className="text-fg3">Cómo alimentó la objeción. </span>{fail.howItFedObjection}</p>
              {fail.principle && (
                <p><span className="text-fg3">Principio. </span>{fail.principle}</p>
              )}
              {fail.recommendation && (
                <p><span className="text-fg3">Recomendación. </span>{fail.recommendation}</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section kicker="Cierre" title="Veredicto y palancas">
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          {report.verdictLevers.map((lever) => (
            <li key={lever}>{lever}</li>
          ))}
        </ol>
      </Section>

      <Section kicker="CRM" title="Notas del prospecto">
        <div className="space-y-3 text-sm">
          <p><span className="text-fg3">Duración y participantes. </span>{notes.durationAndParticipants}</p>
          <p><span className="text-fg3">Por qué agendó. </span>{notes.whyBooked}</p>
          <div>
            <p className="text-fg3">Problema y dolor</p>
            <List items={notes.problemAndPain} />
          </div>
          <div>
            <p className="text-fg3">Situación actual</p>
            <List items={notes.currentSituation} />
          </div>
          <p><span className="text-fg3">Contexto. </span>{notes.context}</p>
          <p><span className="text-fg3">Cómo se siente y miedos. </span>{notes.feelingsAndFears}</p>
          <div>
            <p className="text-fg3">Esfuerzos actuales</p>
            <List items={notes.currentEfforts} />
          </div>
          <div>
            <p className="text-fg3">Soluciones pasadas</p>
            <List items={notes.pastSolutions} />
          </div>
          <p><span className="text-fg3">Tiempo y urgencia. </span>{notes.timeAndUrgency}</p>
          <div>
            <p className="text-fg3">Deseos</p>
            <List items={notes.desires} />
          </div>
          <p><span className="text-fg3">Capacidad de inversión y quién decide. </span>{notes.investmentAndDecider}</p>
          <p><span className="text-fg3">Programa y plan de pago. </span>{notes.programPresented}</p>
          <p><span className="text-fg3">Expectativas. </span>{notes.expectations}</p>
          <p><span className="text-fg3">Resultado y siguientes pasos. </span>{notes.outcomeAndNextSteps}</p>
          <p><span className="text-fg3">Ángulo de seguimiento. </span>{notes.followUpAngle}</p>
          {notes.reusableQuotes.length > 0 && (
            <div>
              <p className="text-fg3">Citas reutilizables</p>
              <ul className="space-y-1 mt-1">
                {notes.reusableQuotes.map((quote) => (
                  <li key={quote} className="italic text-fg2">«{quote}»</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
