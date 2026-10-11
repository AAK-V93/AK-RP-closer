// Mis ofertas (mockup 06-mis-ofertas, README-rediseno.md). Offers with price,
// commission per close, scripts and confirmed success cases; one friendly
// action when something is missing; tabs behind each offer; «Tus llamadas».
import Link from "next/link";
import { pickerConfig } from "@/lib/cases/drive";
import { offerCompleteness } from "@/lib/metrics";
import { getOfferCases, getOfferScripts, getOffersPage } from "@/lib/read/cached";
import type { OfferCard } from "@/lib/read/offers";
import { requireUserId } from "@/lib/session";
import { commissionLine, priceLine } from "@/lib/format/offer";
import { OfferForm } from "@/components/v2/offer-form";
import { IconCheck, IconPen, IconPlus, IconUpload } from "@/components/v2/icons";
import { V2Nav } from "@/components/v2/nav";
import { CallsCard } from "./calls";
import { CasesTab, CommissionTab, PricesTab, ScriptsTab, archiveForm, hrefFor, offerFormValues } from "./parts";

export const dynamic = "force-dynamic";
// reading links from a Server Action can take a while (sheet + model)
export const maxDuration = 60;

const TABS = [
  { key: "precios", label: "Precios y pago" },
  { key: "comision", label: "Comisión" },
  { key: "guiones", label: "Guiones" },
  { key: "casos", label: "Casos de éxito" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function OfferCardView({ offer, selected }: { offer: OfferCard; selected: boolean }) {
  const c = offerCompleteness(offer);
  const price = priceLine(offer);
  const commission = commissionLine(c.perClose, offer.currency);
  return (
    <div className={`card oc${selected ? " sel" : ""}`}>
      <Link href={hrefFor(offer.id)} style={{ color: "inherit", textDecoration: "none", display: "block" }}>
        <div className="h">
          <h3>{offer.name}</h3>
          {c.complete ? (
            <span className="pill green"><IconCheck />Completa</span>
          ) : (
            <span className="pill amber">{c.steps.length === 1 ? "Casi lista" : "Por completar"}</span>
          )}
        </div>
        <div className="g">
          {price && (
            <div><div className="v">{price.value}</div><div className="l">{price.label}</div></div>
          )}
          <div><div className="v">{commission.value}</div><div className="l">{commission.label}</div></div>
          <div><div className="v">{offer.scripts}</div><div className="l">{offer.scripts === 1 ? "guion" : "guiones"}</div></div>
          <div><div className="v">{offer.cases}</div><div className="l">{offer.cases === 1 ? "caso de éxito" : "casos de éxito"}</div></div>
        </div>
      </Link>
      {c.next ? (
        <div className="fix">
          <span>{c.next.text}</span>
          <Link className="btn sm fixit" href={hrefFor(offer.id, c.next.tab, c.next.tab === "precios" || c.next.tab === "comision" ? { editar: "1" } : {})}>
            {c.next.action}
          </Link>
        </div>
      ) : (
        <div className="ok">Todo listo para practicar y escribir mensajes.</div>
      )}
    </div>
  );
}

export default async function OffersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await requireUserId("/ofertas");
  const page = await getOffersPage(user.id);
  const nueva = one(sp.nueva) === "1";
  const selected = page.offers.find((o) => o.id === one(sp.oferta)) ?? page.offers[0] ?? null;
  const tab: TabKey = (TABS.find((t) => t.key === one(sp.tab))?.key ?? "precios") as TabKey;
  const editing = one(sp.editar) === "1" && Boolean(selected);
  const ok = one(sp.ok);
  const error = one(sp.error);
  const picker = pickerConfig();

  const scripts = selected && tab === "guiones" && !editing ? await getOfferScripts(user.id, selected.id, one(sp.ver) === "todos") : null;
  const cases = selected && tab === "casos" && !editing ? await getOfferCases(user.id, selected.id, one(sp.ver) === "todos") : null;

  return (
    <>
      <V2Nav current="ofertas" name={user.name} email={user.email} />
      <div className="wrap">
        <div className="top">
          <div>
            <h1 className="page">Mis ofertas</h1>
            <div className="pagesub">Lo que vendes, cuánto ganas por cierre, tus guiones y de dónde llegan tus llamadas.</div>
          </div>
          {page.offers.length > 0 && !nueva && (
            <Link href="/ofertas?nueva=1" className="btn pri"><IconPlus />Nueva oferta</Link>
          )}
        </div>

        {ok && <div className="banner ok" role="status">{ok}</div>}
        {error && <div className="banner err" role="alert">{error}</div>}

        {nueva && (
          <div className="card pad det">
            <h2 className="sec" style={{ marginBottom: 16 }}>Nueva oferta</h2>
            <OfferForm initial={offerFormValues(null)} tab="precios" cancelHref="/ofertas" />
          </div>
        )}

        {!nueva && page.offers.length === 0 && (
          <div className="card empty det">
            <h2 className="sec">Sube tu oferta</h2>
            <p>
              Cuéntame qué vendes: pega el texto o sube el PDF. Te propongo el nombre y el precio, tú los revisas y agregas
              cuánto ganas por cada cierre.
            </p>
            <Link href="/ofertas?nueva=1" className="btn pri"><IconUpload />Subir mi oferta</Link>
          </div>
        )}

        {page.offers.length > 0 && (
          <div className="offs">
            {page.offers.map((o) => (
              <OfferCardView key={o.id} offer={o} selected={!nueva && o.id === selected?.id} />
            ))}
          </div>
        )}

        {selected && !nueva && (
          <div className="card det">
            <div className="dh">
              <h2>{selected.name}</h2>
              {!editing && (
                <Link href={hrefFor(selected.id, tab, { editar: "1" })} className="btn sec sm"><IconPen />Editar</Link>
              )}
            </div>
            <div className="utabs" role="tablist">
              {TABS.map((t) => (
                <Link key={t.key} role="tab" aria-selected={t.key === tab} className={t.key === tab ? "on" : undefined} href={hrefFor(selected.id, t.key)}>
                  {t.label}
                </Link>
              ))}
            </div>
            {editing ? (
              <div className="body">
                <OfferForm initial={offerFormValues(selected)} tab={tab} cancelHref={hrefFor(selected.id, tab)} />
                {archiveForm(selected.id)}
              </div>
            ) : tab === "precios" ? (
              <PricesTab offer={selected} />
            ) : tab === "comision" ? (
              <CommissionTab offer={selected} />
            ) : tab === "guiones" && scripts ? (
              <ScriptsTab offer={selected} data={scripts} open={one(sp.guion)} all={one(sp.ver) === "todos"} />
            ) : cases ? (
              <CasesTab
                offer={selected}
                data={cases}
                all={one(sp.ver) === "todos"}
                drive={picker ? { ...picker, connected: page.driveConnected } : null}
                youtube={Boolean(process.env.YOUTUBE_API_KEY?.trim())}
              />
            ) : null}
          </div>
        )}

        <CallsCard fathom={page.fathom} calls={page.calls} open={one(sp.llamadas)} />
      </div>
    </>
  );
}
