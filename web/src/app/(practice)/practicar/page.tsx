import { Metadata } from "next";
import Link from "next/link";
import { Chat } from "@/components/chat";
import { Badge } from "@/components/ui/badge";
import { AuthMenu } from "@/components/auth-menu";

export const metadata: Metadata = {
  title: "Practicar | Closer Trainer",
  description:
    "Practica descubrimiento y objeciones con un prospecto simulado.",
};

export default function PracticePage() {
  return (
    <div className="flex flex-col h-screen bg-bg0 overflow-x-hidden">
      <header className="flex flex-col md:flex-row flex-shrink-0 gap-3 md:h-16 items-center justify-between px-4 md:px-8 py-4 w-full border-b border-separator1 min-w-0">
        <div className="flex items-center gap-3 min-w-0 flex-shrink">
          <Link href="/" className="text-lg font-light truncate">
            Closer Trainer
          </Link>
          <Badge variant="outline" className="hidden sm:inline-flex text-xs">
            Práctica
          </Badge>
        </div>
        <AuthMenu />
      </header>
      <main className="flex-col flex-1 min-h-0 min-w-0 overflow-hidden p-4 w-full flex">
        <div className="w-full h-full flex flex-col mx-auto rounded-2xl bg-bg1 border border-separator1 min-w-0 overflow-hidden">
          <Chat />
        </div>
      </main>
      <footer className="hidden md:flex md:items-center md:gap-2 md:justify-end font-mono uppercase text-right py-3 px-8 text-xs text-fg3 w-full border-t border-separator1">
        Powered by LiveKit Agents + Gemini Live API
      </footer>
    </div>
  );
}
