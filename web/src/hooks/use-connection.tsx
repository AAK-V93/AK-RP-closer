"use client";

import React, {
  createContext,
  useState,
  useCallback,
  useContext,
} from "react";
import { useTraining } from "./use-training-state";
import { trainingHelpers } from "@/lib/training-helpers";

export type ConnectFn = () => Promise<void>;

type ConnectionContextType = {
  shouldConnect: boolean;
  wsUrl: string;
  token: string;
  disconnect: () => Promise<void>;
  connect: ConnectFn;
  isConnecting: boolean;
};

const ConnectionContext = createContext<ConnectionContextType | undefined>(
  undefined,
);

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
  const { trainingState } = useTraining();

  const connect = async () => {
    const validationError = trainingHelpers.validateTraining(
      trainingState.training,
    );
    if (validationError) {
      throw new Error(validationError);
    }

    setIsConnecting(true);
    try {
      const response = await fetch("/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trainingHelpers.toTokenPayload(trainingState)),
      });

      if (!response.ok) {
        const err = await response.json();
        const error = new Error(err.error || "Failed to fetch token") as Error & {
          code?: string;
        };
        error.code = err.code;
        throw error;
      }

      const { accessToken, url } = await response.json();
      setConnectionDetails({
        wsUrl: url,
        token: accessToken,
        shouldConnect: true,
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = useCallback(async () => {
    setConnectionDetails((prev) => ({ ...prev, shouldConnect: false }));
  }, []);

  return (
    <ConnectionContext.Provider
      value={{
        ...connectionDetails,
        disconnect,
        connect,
        isConnecting,
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
