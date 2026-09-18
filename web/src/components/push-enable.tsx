"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

async function subscribePush(publicKey: string) {
  const ready = await navigator.serviceWorker.ready;
  const existing = await ready.pushManager.getSubscription();
  if (existing) return existing;
  return ready.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

export function PushEnable({
  needsPrompt,
  onDone,
}: {
  needsPrompt?: boolean;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void registerWorker();
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      void fetch("/api/push/subscribe")
        .then((r) => r.json())
        .then(async (data) => {
          if (!data.publicKey) return;
          const sub = await subscribePush(data.publicKey);
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          });
        })
        .catch(() => undefined);
    }
  }, []);

  if (!needsPrompt) return null;
  if (typeof window !== "undefined" && !("Notification" in window)) return null;

  const finish = async (subscribe: boolean) => {
    setBusy(true);
    try {
      if (!subscribe) {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompted: true }),
        });
        onDone?.();
        return;
      }
      const vapid = await fetch("/api/push/subscribe").then((r) => r.json());
      if (!vapid.publicKey) {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompted: true }),
        });
        onDone?.();
        return;
      }
      await registerWorker();
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const sub = await subscribePush(vapid.publicKey);
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } else {
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompted: true }),
        });
      }
      onDone?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-fg3">
        Avisos
      </p>
      <p className="text-sm">
        ¿Te aviso en el celular cuando toque un seguimiento? Una sola vez.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          onClick={() => void finish(true)}
        >
          Sí, avísame
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void finish(false)}
        >
          Ahora no
        </Button>
      </div>
    </section>
  );
}
