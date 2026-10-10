"use client";

import { useState, type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { CONFIRM_DELETE_TITLE, deleteCoachAnalysis } from "@/lib/coach-analysis";

/** Trash that never deletes on the first tap: a dialog «¿Borrar este análisis?» asks Sí / No. */
export function DeleteAnalysisButton({
  sessionId,
  onDeleted,
  label = "Borrar este análisis",
  iconOnly = false,
  variant = "outline",
}: {
  sessionId: string;
  onDeleted: () => void;
  label?: string;
  iconOnly?: boolean;
  variant?: "ghost" | "outline" | "destructive";
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const open = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setAsking(true);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await deleteCoachAnalysis(sessionId);
      setAsking(false);
      onDeleted();
    } catch (error) {
      toast({
        title: "No se pudo borrar",
        description: error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const aria = `${label}. Pide confirmación antes de borrar.`;
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? "icon" : "sm"}
        disabled={busy}
        onClick={open}
        aria-label={aria}
        aria-haspopup="dialog"
        title={`${label} (pide confirmación)`}
        leftIcon={<Trash2 />}
      >
        {iconOnly ? null : busy ? "Borrando…" : label}
      </Button>
      <Dialog open={asking} onOpenChange={(next) => (!busy ? setAsking(next) : undefined)}>
        <DialogContent className="max-w-sm" onClick={(event) => event.stopPropagation()}>
          <DialogTitle className="pr-12 lg:pr-10">{CONFIRM_DELETE_TITLE}</DialogTitle>
          <DialogDescription>Se borra el análisis de esta práctica o llamada. No se puede deshacer.</DialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => setAsking(false)}>
              No
            </Button>
            <Button type="button" variant="destructive" className="min-h-11" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Borrando…" : "Sí, borrar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
