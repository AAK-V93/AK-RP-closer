// «Tus llamadas» (mockup 06-mis-ofertas): connect Fathom, upload a call, and
// what is happening with the rebuild. Plain forms, no polling.
import Link from "next/link";
import { backfillWindowDays } from "@/lib/ingest/window";
import { plural } from "@/lib/format/goal";
import { IconPhone, IconUpload } from "@/components/v2/icons";
import { connectFathomAction, disconnectFathomAction, retryBriefsAction, uploadCallAction } from "./calls-actions";

type Props = {
  fathom: { connected: boolean; webhook: boolean; backfill: "NONE" | "RUNNING" | "DONE" | "ERROR"; imported: number };
  calls: { processing: number; failed: number };
  open: string;
};

function statusText(f: Props["fathom"], days: number) {
  if (!f.connected) return <>Conecta Fathom y tus llamadas nuevas llegan solas.</>;
  const brought = f.imported > 0 ? ` Van ${plural(f.imported, "llamada", "llamadas")}.` : "";
  if (f.backfill === "RUNNING") {
    return <>Estoy trayendo tus llamadas de los últimos {days} días; sigo cada vez que entras a Hoy.{brought}</>;
  }
  if (f.backfill === "ERROR") return <>Fathom no aceptó tu clave. Conéctalo de nuevo con una clave nueva.</>;
  if (!f.webhook) return <>En esta versión de prueba las llamadas nuevas no llegan solas: súbelas aquí.</>;
  return <>Tus llamadas nuevas llegan solas.{f.backfill === "DONE" && f.imported > 0 ? ` Traje ${f.imported} de los últimos ${days} días.` : ""}</>;
}

export function CallsCard({ fathom, calls, open }: Props) {
  const stuck = calls.failed + calls.processing;
  const days = backfillWindowDays();
  return (
    <>
      <div className="card calls" id="llamadas">
        <div className="ci"><IconPhone /></div>
        <div>
          <div className="t">Tus llamadas</div>
          <div className="s">
            {fathom.connected && (
              <span className={`pill ${fathom.backfill === "ERROR" ? "grey" : "green"}`} style={{ fontSize: 12, padding: "2px 9px" }}>
                <span className="dot" />Conectado a Fathom
              </span>
            )}
            {statusText(fathom, days)}
          </div>
          <div className="s">Si Fathom no resume una llamada, súbela.</div>
        </div>
        <Link href="/ofertas?llamadas=subir#llamadas" className="btn sec sm"><IconUpload />Subir una llamada</Link>
        <Link href="/ofertas?llamadas=conectar#llamadas" className="small">{fathom.connected ? "Cambiar conexión" : "Conectar Fathom"}</Link>
      </div>

      {stuck > 0 && (
        <div className="card pad callsx">
          <div className="small">
            {calls.failed > 0 && <>{calls.failed === 1 ? "1 llamada no se pudo resumir." : `${calls.failed} llamadas no se pudieron resumir.`} </>}
            {calls.processing > 0 && <>{calls.processing === 1 ? "Estoy resumiendo 1 llamada." : `Estoy resumiendo ${calls.processing} llamadas.`}</>}
          </div>
          <form action={retryBriefsAction}>
            <button type="submit" className="btn sec sm">Reintentar</button>
          </form>
        </div>
      )}

      {open === "conectar" && (
        <div className="card pad callsx">
          <form action={connectFathomAction} className="form">
            <label className="field">
              <span>Tu clave de Fathom</span>
              <input name="apiKey" type="password" autoComplete="off" required maxLength={300} placeholder="Pega aquí tu clave" />
            </label>
            <div className="small muted">
              En Fathom: Settings › API Access › Generate API key. La guardo cifrada. Al conectar traigo tus llamadas de los
              últimos {days} días y desde ahí las nuevas llegan solas.
            </div>
            <div><button type="submit" className="btn pri sm">{fathom.connected ? "Conectar con esta clave" : "Conectar Fathom"}</button></div>
          </form>
          {fathom.connected && (
            <form action={disconnectFathomAction} style={{ marginTop: 14 }}>
              <button type="submit" className="btn sec sm">Desconectar Fathom</button>
              <span className="small muted" style={{ marginLeft: 10 }}>Las llamadas que ya traje se quedan.</span>
            </form>
          )}
        </div>
      )}

      {open === "subir" && (
        <div className="card pad callsx">
          <form action={uploadCallAction} className="form">
            <label className="field">
              <span>Archivo de la transcripción (.txt, .vtt o .srt)</span>
              <input name="file" type="file" accept=".txt,.vtt,.srt,text/plain,text/vtt" />
            </label>
            <label className="field">
              <span>O pega la transcripción</span>
              <textarea name="text" rows={5} placeholder="[00:00:05] Ana: Hola, ¿me escuchas?" />
            </label>
            <div className="row">
              <label className="field">
                <span>¿Con quién fue? (opcional)</span>
                <input name="title" maxLength={200} placeholder="Llamada con Ana" />
              </label>
              <label className="field">
                <span>Fecha de la llamada</span>
                <input name="date" type="date" />
              </label>
            </div>
            <div className="small muted">Por ahora sube el texto de la llamada; Fathom y Zoom te dejan descargarlo.</div>
            <div><button type="submit" className="btn pri sm"><IconUpload />Subir llamada</button></div>
          </form>
        </div>
      )}
    </>
  );
}
