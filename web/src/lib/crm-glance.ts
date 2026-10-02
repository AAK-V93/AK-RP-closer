import { plainStatus } from "@/lib/plain-labels";

export function operacionGlance(args: {
  fecha?: string | null;
  fechaProximo?: string | null;
  tipoSeguimiento?: string | null;
  paso?: string | null;
  ultimoContacto?: string | null;
}) {
  const rawPaso = String(args.paso || "").trim();
  const paso =
    !rawPaso || rawPaso === "—"
      ? ""
      : /^paso\b/i.test(rawPaso)
        ? rawPaso
        : `Paso ${rawPaso}`;
  const ultimoContacto = String(args.ultimoContacto || args.fecha || "").trim().slice(0, 16) || "—";
  const tipo = plainStatus(args.tipoSeguimiento);
  const when = String(args.fechaProximo || "").trim();
  const parts = [tipo !== "—" ? tipo : "", when].filter(Boolean);
  const siguiente = parts.length ? parts.join(" · ") : "Sin próximo paso";
  const line = [
    paso,
    ultimoContacto !== "—" ? `Último contacto ${ultimoContacto}` : "",
    `Siguiente: ${siguiente}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { paso, ultimoContacto, siguiente, line };
}
