"use client";

import React, {
  createContext,
  useState,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useSession } from "next-auth/react";
import { useTraining } from "./use-training-state";
import { trainingHelpers } from "@/lib/training-helpers";

export type ConnectFn = () => Promise<void>;

export type ConnectPhase = "idle" | "preparing" | "audio" | "ready" | "error";

const CONNECT_TIMEOUT_MS = 70_000;
const PREPARE_TTL_MS = 50_000;

type TokenDetails = { accessToken: string; url: string };

type ConnectionContextType = {
  shouldConnect: boolean;
  wsUrl: string;
  token: string;
  disconnect: () => Promise<void>;
  connect: ConnectFn;
  isConnecting: boolean;
  phase: ConnectPhase;
  errorMessage: string | null;
  cancel: () => void;
  prefetch: () => void;
  markReady: () => void;
};

const ConnectionContext = createContext<ConnectionContextType | undefined>(
  undefined,
);

function friendlyError(error: unknown) {
  if (error instanceof Error && error.message && error.message !== "cancel") {
    return error.message;
  }
  return "No pude conectar la práctica. Revisa tu conexión e inténtalo otra vez.";
}

export const ConnectionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [connectionDetails, setConnectionDetails] = useState({
    wsUrl: "",
    token: "",
    shouldConnect: false,
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { trainingState } = useTraining();
  const { status } = useSession();
  const abortRef = useRef<AbortController | null>(null);
  const connectStartedRef = useRef<number | null>(null);
  const cacheRef = useRef<{ key: string; at: number; promise: Promise<TokenDetails> } | null>(
    null,
  );
  const trainingRef = useRef(trainingState);
  trainingRef.current = trainingState;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const requestKey = useCallback(() => {
    const training = trainingState.training;
    const session = trainingState.sessionConfig;
    return JSON.stringify({
      offerId: training.offerId || "",
      productName: training.productName,
      difficulty: training.difficulty,
      callSection: training.callSection,
      language: training.language,
      practiceKind: training.practiceKind || "compose",
      replay: training.replayCall?.sourceId || "",
      focus: training.practiceFocus || "",
      model: session.model,
      voice: session.voice,
      modalities: session.modalities,
    });
  }, [trainingState]);

  const fetchToken = useCallback(
    (signal?: AbortSignal) => {
      const key = requestKey();
      const cached = cacheRef.current;
      if (cached && cached.key === key && Date.now() - cached.at < PREPARE_TTL_MS) {
        return cached.promise;
      }
      const promise = (async () => {
        const response = await fetch("/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trainingHelpers.toTokenPayload(trainingRef.current)),
          signal,
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          const error = new Error(err.error || "No pude preparar la práctica") as Error & {
            code?: string;
          };
          error.code = err.code;
          throw error;
        }
        const data = (await response.json()) as TokenDetails;
        if (!data.accessToken || !data.url) {
          throw new Error("No pude preparar la práctica");
        }
        return data;
      })();
      cacheRef.current = { key, at: Date.now(), promise };
      promise.catch(() => {
        if (cacheRef.current?.promise === promise) cacheRef.current = null;
      });
      return promise;
    },
    [requestKey],
  );

  const prefetch = useCallback(() => {
    const training = trainingRef.current.training;
    if (trainingHelpers.validateTraining(training)) return;
    if (phaseRef.current === "preparing" || phaseRef.current === "audio") return;
    void fetchToken().catch(() => undefined);
  }, [fetchToken]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/practice/warm").catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (trainingHelpers.validateTraining(trainingState.training)) return;
    const timer = window.setTimeout(() => prefetch(), 800);
    return () => window.clearTimeout(timer);
  }, [prefetch, requestKey, status, trainingState.training]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    cacheRef.current = null;
    setConnectionDetails((prev) => ({ ...prev, shouldConnect: false }));
    setIsConnecting(false);
    setErrorMessage(null);
    setPhase("idle");
  }, []);

  const fail = useCallback((message: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    cacheRef.current = null;
    setConnectionDetails({ wsUrl: "", token: "", shouldConnect: false });
    setIsConnecting(false);
    setErrorMessage(message);
    setPhase("error");
  }, []);

  useEffect(() => {
    if (phase !== "preparing" && phase !== "audio") {
      connectStartedRef.current = null;
      return;
    }
    if (!connectStartedRef.current) connectStartedRef.current = Date.now();
    const remaining = Math.max(0, CONNECT_TIMEOUT_MS - (Date.now() - connectStartedRef.current));
    const timer = window.setTimeout(() => {
      fail(
        "Está tardando más de lo normal. Puedes cancelar o intentarlo otra vez en un momento.",
      );
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [fail, phase]);

  const connect = async () => {
    const validationError = trainingHelpers.validateTraining(trainingRef.current.training);
    if (validationError) {
      throw new Error(validationError);
    }

    const ac = new AbortController();
    abortRef.current = ac;
    setErrorMessage(null);
    setPhase("preparing");
    setIsConnecting(true);
    try {
      const details = await fetchToken(ac.signal);
      if (ac.signal.aborted) return;
      setConnectionDetails({
        wsUrl: details.url,
        token: details.accessToken,
        shouldConnect: true,
      });
      setPhase("audio");
    } catch (error) {
      if (ac.signal.aborted) return;
      const message = friendlyError(error);
      fail(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  const markReady = useCallback(() => {
    setPhase("ready");
    setErrorMessage(null);
  }, []);

  const disconnect = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setConnectionDetails((prev) => ({ ...prev, shouldConnect: false }));
    setIsConnecting(false);
    setPhase((current) => (current === "error" ? current : "idle"));
  }, []);

  return (
    <ConnectionContext.Provider
      value={{
        ...connectionDetails,
        disconnect,
        connect,
        isConnecting,
        phase,
        errorMessage,
        cancel,
        prefetch,
        markReady,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};

export function useConnection() {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnection must be used within ConnectionProvider");
  }
  return context;
}
