"use client";
// «Elegir desde mi Drive»: Google Picker with scope drive.file. The token
// comes from /api/drive/token (the person's own Drive consent, not Calendar's).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDriveSheetAction } from "@/app/(v2)/ofertas/actions";

type PickerDoc = { id: string; name?: string; url?: string };
type PickerData = { action: string; docs?: PickerDoc[] };
type Builder = {
  addView(v: unknown): Builder;
  setOAuthToken(t: string): Builder;
  setDeveloperKey(k: string): Builder;
  setAppId(id: string): Builder;
  setLocale(l: string): Builder;
  setCallback(cb: (d: PickerData) => void): Builder;
  build(): { setVisible(v: boolean): void };
};
type GooglePicker = {
  PickerBuilder: new () => Builder;
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string };
};
type Gapi = { load(name: string, cb: () => void): void };

declare global {
  interface Window {
    gapi?: Gapi;
    google?: { picker?: GooglePicker };
  }
}

function loadPicker(): Promise<GooglePicker> {
  return new Promise((resolve, reject) => {
    const ready = () => window.gapi!.load("picker", () => (window.google?.picker ? resolve(window.google.picker) : reject(new Error("picker"))));
    if (window.gapi) return ready();
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = ready;
    s.onerror = () => reject(new Error("script"));
    document.head.appendChild(s);
  });
}

export function DrivePickerButton({ offerId, apiKey, appId }: { offerId: string; apiKey: string; appId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/drive/token", { cache: "no-store" });
      const data = (await res.json()) as { accessToken?: string; error?: string };
      if (!res.ok || !data.accessToken) {
        setNote(data.error ?? "Vuelve a conectar tu Drive.");
        return;
      }
      const picker = await loadPicker();
      new picker.PickerBuilder()
        .addView(picker.ViewId.SPREADSHEETS)
        .setOAuthToken(data.accessToken)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .setLocale("es")
        .setCallback(async (d: PickerData) => {
          if (d.action !== picker.Action.PICKED || !d.docs?.[0]) return;
          const doc = d.docs[0];
          setBusy(true);
          const r = await addDriveSheetAction(offerId, { id: doc.id, name: doc.name ?? null, url: doc.url ?? null });
          setBusy(false);
          setNote(r.ok ? r.message || r.error || "Listo." : r.error);
          router.refresh();
        })
        .build()
        .setVisible(true);
    } catch {
      setNote("No pude abrir tu Drive. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" className="btn sec sm" onClick={open} disabled={busy}>
        {busy ? "Abriendo…" : "Elegir desde mi Drive"}
      </button>
      {note && <span className="small muted">{note}</span>}
    </span>
  );
}
