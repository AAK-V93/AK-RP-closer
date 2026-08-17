"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConnection } from "@/hooks/use-connection";
import { Loader2, PhoneCall } from "lucide-react";
import { useTraining } from "@/hooks/use-training-state";
import { toast } from "@/hooks/use-toast";
import {
  CUSTOM_OFFER_CODE,
  FREE_USED_CODE,
} from "@/lib/guest-practice-client";
import {
  REGISTER_AFTER_FREE_URL,
  REGISTER_CUSTOM_OFFER_URL,
  usePracticeAccess,
} from "@/hooks/use-practice-access";
import { isPresetOffer } from "@/data/offer-cases";

export function ConnectButton() {
  const { connect, shouldConnect, isConnecting } = useConnection();
  const { helpers, trainingState } = useTraining();
  const { access, status } = usePracticeAccess();
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const { training } = trainingState;
  const tryingCustomOffer =
    Boolean(training.productName.trim()) &&
    !isPresetOffer(training.productName, training.productDescription);

  const handleConnect = async () => {
    if (access && !access.authenticated && !access.allowed) {
      router.push(REGISTER_AFTER_FREE_URL);
      return;
    }

    if (status === "unauthenticated" && tryingCustomOffer) {
      router.push(REGISTER_CUSTOM_OFFER_URL);
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
      if (code === FREE_USED_CODE) {
        router.push(REGISTER_AFTER_FREE_URL);
        return;
      }
      if (code === CUSTOM_OFFER_CODE) {
        router.push(REGISTER_CUSTOM_OFFER_URL);
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
  const usedFree = Boolean(access && !access.authenticated && !access.allowed);
  const needsCustomAccount =
    status === "unauthenticated" && tryingCustomOffer;

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
      ) : usedFree ? (
        <>
          <PhoneCall className="h-4 w-4 mr-2" />
          Crear cuenta para practicar
        </>
      ) : needsCustomAccount ? (
        <>
          <PhoneCall className="h-4 w-4 mr-2" />
          Crear cuenta para tu oferta
        </>
      ) : (
        <>
          <PhoneCall className="h-4 w-4 mr-2" />
          Entrar a la reunión — tú hablas primero
        </>
      )}
    </Button>
  );
}
