"use client";
import { useFormStatus } from "react-dom";

export function Submit({ children, pending, className = "btn pri" }: { children: React.ReactNode; pending?: string; className?: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={busy}>
      {busy && pending ? pending : children}
    </button>
  );
}
