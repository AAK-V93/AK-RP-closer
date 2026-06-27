"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/hooks/use-connection";
import { Loader2, PhoneCall } from "lucide-react";
import { useTraining } from "@/hooks/use-training-state";
import { toast } from "@/hooks/use-toast";

export function ConnectButton() {
  const { connect, shouldConnect, isConnecting } = useConnection();
  const { helpers, trainingState } = useTraining();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    const validationError = helpers.validateTraining(trainingState.training);
    if (validationError) {
      toast({
        title: "Configuración incompleta",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    setConnecting(true);
    try {
      await connect();
    } catch (error) {
      toast({
        title: "Error de conexión",
        description:
          error instanceof Error ? error.message : "No se pudo iniciar la práctica",
        variant: "destructive",
      });
    } finally {
      setConnecting(false);
    }
  };

  const busy = connecting || isConnecting || shouldConnect;

  return (
    <Button
      onClick={handleConnect}
      disabled={busy}
      variant="primary"
      className="text-sm font-semibold p-2 h-9"
    >
      {busy ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Conectando...
        </>
      ) : (
        <>
          <PhoneCall className="h-4 w-4 mr-2" />
          Iniciar práctica con prospecto
        </>
      )}
    </Button>
  );
}
