"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  { k: "Llamadas", t: "Entran solas desde Fathom o las subes." },
  { k: "Voz", t: "Agente de voz de práctica: el prospecto habla como tus leads." },
  { k: "Coach", t: "Te dice el patrón, no un score suelto." },
  { k: "CRM", t: "Sabes a quién escribir y qué decir." },
];

export function CycleIntro() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % STEPS.length), 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-4 overflow-hidden">
      <p className="text-sm text-fg3">El ciclo</p>
      <div className="flex gap-2">
        {STEPS.map((step, idx) => (
          <div
            key={step.k}
            className={
              idx === i
                ? "h-1 flex-1 rounded-full bg-primary"
                : "h-1 flex-1 rounded-full bg-separator1"
            }
          />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={STEPS[i].k}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28 }}
          className="min-h-[72px]"
        >
          <p className="font-display text-3xl text-fg0">{STEPS[i].k}</p>
          <p className="text-sm text-fg3 mt-1">{STEPS[i].t}</p>
        </motion.div>
      </AnimatePresence>
      <p className="text-sm text-fg3">Llamadas, voz, coach, CRM.</p>
    </div>
  );
}
