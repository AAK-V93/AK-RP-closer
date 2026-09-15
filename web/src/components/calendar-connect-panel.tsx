"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CalendarConnectPanel({ authenticated }: { authenticated: boolean }) {
  const [state, setState] = useState<{
    configured?: boolean;
    connected?: boolean;
    syncedAt?: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!authenticated) return;
    const res = await fetch("/api/calendar");
    const data = await res.json();
    if (res.ok) setState(data);
  }, [authenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!authenticated || !state?.configured) return null;

  return (
    <div className="rounded-2xl border border-separator1 bg-bg1 p-4 space-y-2">
      <p className="text-sm font-medium flex items-center gap-2">
        <CalendarDays className="h-4 w-4" />
        Google Calendar
      </p>
      <p className="text-xs text-fg3">
        Eventos con Zoom o Meet entran como AGENDADO. A las 24 h, si no hay
        transcript, el hub pregunta si se hizo.
      </p>
      {state.connected ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await fetch("/api/calendar", { method: "POST" });
              await load();
              setBusy(false);
            }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Sincronizar"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await fetch("/api/calendar", { method: "DELETE" });
              await load();
            }}
          >
            Desconectar
          </Button>
          {state.syncedAt ? (
            <span className="text-[11px] text-fg3 self-center">
              Último sync {new Date(state.syncedAt).toLocaleString()}
            </span>
          ) : null}
        </div>
      ) : (
        <Button asChild size="sm" variant="primary">
          <a href="/api/calendar/connect">Conectar Calendar</a>
        </Button>
      )}
    </div>
  );
}
