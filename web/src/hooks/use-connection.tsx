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
import {
  isPracticeQaRequest,
  micHowToFix,
  PRACTICE_QA_STORAGE_KEY,
  practiceQaStorageAction,
  type PracticeErrorKind,
  type PracticeStageTiming,
} from "@/lib/practice-qa";

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
  errorKind: PracticeErrorKind | null;
  qaMode: boolean;
  stageTimings: PracticeStageTiming[];
  cancel: () => void;
  prefetch: () => void;
  markReady: () => void;
  markRoomJoined: (at?: number) => void;
  markAgentJoined: (at?: number) => void;
  liveStage: PracticeStageTiming | null;
  /** Milliseconds timestamp of the user's start click. */
  clockOrigin: number | null;
  /** Milliseconds timestamp of the first remote audio. Null until the call is live. */
  voiceStartedAt: number | null;
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
  const [errorKind, setErrorKind] = useState<PracticeErrorKind | null>(null);
  const [qaMode, setQaMode] = useState(false);
  const [stageTimings, setStageTimings] = useState<PracticeStageTiming[]>([]);
  const [liveStage, setLiveStage] = useState<PracticeStageTiming | null>(null);
  const [clockOrigin, setClockOrigin] = useState<number | null>(null);
  const [voiceStartedAt, setVoiceStartedAt] = useState<number | null>(null);
  const clockOriginRef = useRef<number | null>(null);
  const cancelingRef = useRef(false);
  const stageRef = useRef<{ name: string; at: number } | null>(null);
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
    if (typeof window === "undefined") return;
    const action = practiceQaStorageAction(window.location.search);
    if (action === "set") window.localStorage.setItem(PRACTICE_QA_STORAGE_KEY, "1");
    if (action === "clear") window.localStorage.removeItem(PRACTICE_QA_STORAGE_KEY);
    setQaMode(isPracticeQaRequest(window.location.search, window.localStorage.getItem(PRACTICE_QA_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/practice/warm").catch(() => undefined);
  }, [status]);

  const noteStage = useCallback((name: string, at = Date.now()) => {
    const now = at;
    const prev = stageRef.current;
    if (prev) {
      const ms = Math.max(0, now - prev.at);
      console.info("[práctica]", { etapa: prev.name, ms });
      setStageTimings((rows) => [...rows, { stage: prev.name, ms }]);
    }
    stageRef.current = { name, at: now };
    setLiveStage({ stage: name, ms: 0 });
  }, []);

  const closeStage = useCallback((at = Date.now()) => {
    const prev = stageRef.current;
    if (!prev) return;
    const ms = at - prev.at;
    console.info("[práctica]", { etapa: prev.name, ms });
    setStageTimings((rows) => [...rows, { stage: prev.name, ms }]);
    stageRef.current = null;
    setLiveStage(null);
  }, []);

  useEffect(() => {
    if (phase !== "preparing" && phase !== "audio") return;
    const timer = window.setInterval(() => {
      const current = stageRef.current;
      if (!current) return;
      setLiveStage({ stage: current.name, ms: Date.now() - current.at });
    }, 400);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (trainingHelpers.validateTraining(trainingState.training)) return;
    const timer = window.setTimeout(() => prefetch(), 800);
    return () => window.clearTimeout(timer);
  }, [prefetch, requestKey, status, trainingState.training]);

  const cancel = useCallback(() => {
    if (cancelingRef.current) return;
    cancelingRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    cacheRef.current = null;
    setConnectionDetails((prev) => ({ ...prev, shouldConnect: false }));
    setIsConnecting(false);
    setErrorMessage(null);
    setErrorKind(null);
    setPhase("idle");
    clockOriginRef.current = null;
    setClockOrigin(null);
    setVoiceStartedAt(null);
  }, []);

  const fail = useCallback((message: string, kind: PracticeErrorKind = "connection") => {
    abortRef.current?.abort();
    abortRef.current = null;
    cacheRef.current = null;
    setConnectionDetails({ wsUrl: "", token: "", shouldConnect: false });
    setIsConnecting(false);
    setErrorMessage(message);
    setErrorKind(kind);
    phaseRef.current = "error";
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
      noteStage("timeout");
      fail("No pude conectar. Revisa tu conexión e inténtalo otra vez.");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [fail, noteStage, phase]);

  const connect = async () => {
    const validationError = trainingHelpers.validateTraining(trainingRef.current.training);
    if (validationError) {
      throw new Error(validationError);
    }

    const ac = new AbortController();
    abortRef.current = ac;
    cancelingRef.current = false;
    setErrorMessage(null);
    setErrorKind(null);
    setStageTimings([]);
    setLiveStage(null);
    stageRef.current = null;
    const started = Date.now();
    clockOriginRef.current = started;
    setClockOrigin(started);
    setVoiceStartedAt(null);
    setPhase("preparing");
    setIsConnecting(true);
    try {
      noteStage("mic");
      const tokenPromise = fetchToken(ac.signal);
      if (!qaMode) {
        if (!navigator.mediaDevices?.getUserMedia) {
          ac.abort();
          fail(micHowToFix(), "mic");
          throw new Error(micHowToFix());
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch (micError) {
          ac.abort();
          const name = micError instanceof DOMException ? micError.name : "";
          const blocked = name === "NotAllowedError" || name === "SecurityError";
          const message = blocked
            ? "El navegador bloqueó el micrófono. Permítelo en el candado de la barra de direcciones y vuelve a entrar."
            : micHowToFix();
          fail(message, "mic");
          throw new Error(message);
        }
      }
      if (ac.signal.aborted) return;
      noteStage("token");
      const details = await tokenPromise;
      if (ac.signal.aborted) return;
      setConnectionDetails({
        wsUrl: details.url,
        token: details.accessToken,
        shouldConnect: true,
      });
      noteStage("sala");
      setPhase("audio");
    } catch (error) {
      if (ac.signal.aborted) return;
      if (phaseRef.current === "error") throw error instanceof Error ? error : new Error(friendlyError(error));
      const message = friendlyError(error);
      fail(message, "connection");
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setIsConnecting(false);
    }
  };

  const markRoomJoined = useCallback((at?: number) => {
    if (stageRef.current?.name !== "sala") return;
    noteStage("agente", at);
  }, [noteStage]);

  const markAgentJoined = useCallback((at?: number) => {
    if (stageRef.current?.name !== "agente") return;
    noteStage("voz", at);
  }, [noteStage]);

  const markReady = useCallback(() => {
    const at = Date.now();
    if (stageRef.current?.name === "sala") noteStage("agente", at);
    if (stageRef.current?.name === "agente") noteStage("voz", at);
    if (stageRef.current?.name === "voz") closeStage(at);
    else closeStage();
    setVoiceStartedAt(at);
    setPhase("ready");
    setErrorMessage(null);
    setErrorKind(null);
  }, [closeStage, noteStage]);

  const disconnect = useCallback(async () => {
    if (cancelingRef.current) return;
    cancelingRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setConnectionDetails((prev) => ({ ...prev, shouldConnect: false }));
    setIsConnecting(false);
    setPhase((current) => (current === "error" ? current : "idle"));
    clockOriginRef.current = null;
    setClockOrigin(null);
    setVoiceStartedAt(null);
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
        errorKind,
        qaMode,
        stageTimings,
        liveStage,
        cancel,
        prefetch,
        markReady,
        markRoomJoined,
        markAgentJoined,
        clockOrigin,
        voiceStartedAt,
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
