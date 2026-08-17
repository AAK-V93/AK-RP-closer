import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reporte de llamada | Closer Trainer",
  description:
    "Sube la transcripción de una llamada real y recibe un reporte de QC: ficha, descubrimiento, pitch, objeciones y palancas.",
};

export default function ReporteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
