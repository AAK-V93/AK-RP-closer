"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

export function RouteError({
  title,
  reset,
}: {
  title: string;
  reset: () => void;
}) {
  const retry = React.useCallback(() => reset(), [reset]);
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-light">{title}</h1>
      <p className="text-sm text-fg3">
        Algo falló al pintar esta pantalla. Puedes reintentar.
      </p>
      <div>
        <Button type="button" variant="primary" onClick={retry}>
          Reintentar
        </Button>
      </div>
    </div>
  );
}
