"use client";

import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { ConfigurationFormDrawer } from "@/components/configuration-form-drawer";
import { useTraining } from "@/hooks/use-training-state";
import { useConnection } from "@/hooks/use-connection";
import { cn } from "@/lib/utils";

export function ChatControls() {
  const { trainingState } = useTraining();
  const { shouldConnect } = useConnection();
  const needsOffer =
    !trainingState.training.productName.trim() && !shouldConnect;

  return (
    <div className="absolute top-2 left-2 right-2 z-20 flex justify-between">
      <ConfigurationFormDrawer>
        <Button
          variant={needsOffer ? "primary" : "outline"}
          size="lg"
          className={cn("relative md:hidden gap-2", needsOffer && "pr-3")}
        >
          {needsOffer && (
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-1 rounded-md border-2 border-fgAccent1 animate-ping"
            />
          )}
          <Settings className="h-4 w-4" />
          {needsOffer ? "Elegir oferta" : "Oferta"}
        </Button>
      </ConfigurationFormDrawer>
    </div>
  );
}
