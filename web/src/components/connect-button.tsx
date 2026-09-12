"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/hooks/use-connection";
import { Loader2, PhoneCall } from "lucide-react";
import { useTraining } from "@/hooks/use-training-state";
import { toast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";
import { FREE_USED_CODE } from "@/lib/guest-practice-client";

export function ConnectButton() {
  const { connect, shouldConnect, isConnecting } = useConnection();
  const { helpers, trainingState } = useTraining();
  const { status } = useSession();
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const { training } = trainingState;

  const handleConnect = async () => {
    if (status === "unauthenticated") {
      router.push("/login?mode=register&callbackUrl=/setup");
      return;
    }
    if (!training.productName.trim()) {
      router.push("/setup");
      return;
    }

    const validationError = helpers.validateTraining(training);
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
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code === FREE_USED_CODE || code === "SETUP_REQUIRED") {
        router.push("/setup");
        return;
      }
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
  const needsSetup = status !== "authenticated" || !training.productName.trim();

  return (
    <Button
      onClick={handleConnect}
      disabled={busy}
      variant="primary"
      size="xl"
      className="w-full md:w-auto text-sm font-semibold"
    >
      {busy ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Conectando...
        </>
      ) : needsSetup ? (
        <>
          <PhoneCall className="h-4 w-4 mr-2" />
          Configurar mi oferta
        </>
      ) : (
        <>
          <PhoneCall className="h-4 w-4 mr-2" />
          <span className="md:hidden">Entrar a la reunión</span>
          <span className="hidden md:inline">
            Entrar a la reunión — tú hablas primero
          </span>
        </>
      )}
    </Button>
  );
}
