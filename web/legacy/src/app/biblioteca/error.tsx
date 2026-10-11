"use client";

import { RouteError } from "@/components/route-error";

export default function BibliotecaError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="No se pudo mostrar la biblioteca" reset={reset} />;
}
