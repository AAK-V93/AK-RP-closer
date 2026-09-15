"use client";

import { useState, type MouseEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  CONFIRM_DELETE_ANALYSIS,
  deleteCoachAnalysis,
} from "@/lib/coach-analysis";

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

  const handleClick = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!window.confirm(CONFIRM_DELETE_ANALYSIS)) return;
    setBusy(true);
    try {
      await deleteCoachAnalysis(sessionId);
      onDeleted();
    } catch (error) {
      toast({
        title: "No se pudo borrar",
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? "icon" : "sm"}
      disabled={busy}
      onClick={handleClick}
      aria-label={label}
      title={label}
      leftIcon={<Trash2 />}
    >
      {iconOnly ? null : busy ? "Borrando…" : label}
    </Button>
  );
}
