import { Suspense } from "react";
import { Metadata } from "next";
import { Chat } from "@/components/chat";
import { TrainingSetupForm } from "@/components/training-setup-form";

export const metadata: Metadata = {
  title: "Practicar | Closer Trainer",
  description:
    "Practica descubrimiento y objeciones con un prospecto simulado.",
};

export default function PracticePage() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4 md:min-h-[calc(100dvh-7.5rem)] md:flex-row">
      {/* On a laptop the page scrolls: every setting under «Cómo practicar» stays reachable. */}
      <aside className="hidden min-h-0 overflow-y-auto rounded-2xl border border-separator1 bg-bg1 p-4 md:block md:w-[340px] md:shrink-0">
        <Suspense fallback={null}>
          <TrainingSetupForm />
        </Suspense>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-separator1 bg-bg1">
        <Chat />
      </section>
    </div>
  );
}
