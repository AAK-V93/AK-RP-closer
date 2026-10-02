"use client";

import { RouteError } from "@/components/route-error";

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError title="No se pudo mostrar esta página" reset={reset} />;
}
