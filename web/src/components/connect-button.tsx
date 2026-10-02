"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/hooks/use-connection";
import { Loader2, PhoneCall } from "lucide-react";
import { useTraining } from "@/hooks/use-training-state";
import { toast } from "@/hooks/use-toast";
import { useSession } from "next-auth/react";

export function ConnectButton() {
  const { connect, shouldConnect, isConnecting, phase, prefetch, cancel } = useConnection();
  const { helpers, trainingState } = useTraining();
  const { status } = useSession();
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const { training } = trainingState;

  const handleConnect = async () => {
    if (status === "unauthenticated") {
      router.push("/login?mode=register&callbackUrl=/ofertas");
      return;
    }
    if (!training.productName.trim()) {
      router.push("/ofertas");
      return;
    }

    const validationError = helpers.validateTraining(training);
    if (validationError) {
      toast({
        title: "Falta la oferta",
        description: validationError,
        variant: "destructive",
      });
      return;
    }

    setConnecting(true);
    try {
      try {
        await connect();
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: string }).code)
            : "";
        if (code === "SETUP_REQUIRED") {
          router.push("/ofertas");
        }
      }
    } finally {
      setConnecting(false);
    }
  };

  const busy = connecting || isConnecting || phase === "preparing" || phase === "audio" || shouldConnect;
  const needsSetup = status !== "authenticated" || !training.productName.trim();
  const label =
    phase === "audio" ? "Conectando el audio…" : phase === "preparing" ? "Preparando al cliente…" : "Conectando…";

  if (busy && !needsSetup) {
    return (
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
        <Button disabled variant="primary" size="xl" className="w-full sm:w-auto text-sm font-semibold">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {label}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xl"
          className="w-full sm:w-auto"
          onClick={cancel}
        >
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <Button
      onClick={handleConnect}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      disabled={busy}
      variant="primary"
      size="xl"
      className="w-full md:w-auto text-sm font-semibold whitespace-normal h-auto min-h-11 text-center"
    >
      {needsSetup ? (
        <>
          <PhoneCall className="h-4 w-4 mr-2 shrink-0" />
          Configurar mi oferta
        </>
      ) : (
        <>
          <PhoneCall className="h-4 w-4 mr-2 shrink-0" />
          <span className="md:hidden">Entrar a la reunión</span>
          <span className="hidden md:inline">Entrar a la reunión — tú hablas primero</span>
        </>
      )}
    </Button>
  );
}
