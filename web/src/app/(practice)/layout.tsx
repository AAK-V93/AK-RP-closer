import { Suspense } from "react";
import Link from "next/link";
import { TrainingProvider } from "@/hooks/use-training-state";
import { ConnectionProvider } from "@/hooks/use-connection";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
} from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/custom/theme-toggle";
import { RoomWrapper } from "@/components/room-wrapper";
import { TrainingSetupForm } from "@/components/training-setup-form";
import { PracticeReadyGate } from "@/components/practice-ready-gate";
import { PracticeTabBar } from "@/components/practice-tab-bar";

export default function PracticeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TrainingProvider>
      <ConnectionProvider>
        <TooltipProvider>
          <RoomWrapper>
            <PracticeReadyGate />
            <SidebarProvider defaultOpen={true}>
              <Sidebar className="bg-bg1">
                <SidebarHeader className="px-4 py-3 space-y-2">
                  <Link href="/" className="inline-flex h-11 min-h-11 items-center text-sm font-semibold tracking-tight lg:h-auto lg:min-h-0">
                    Closer Trainer
                  </Link>
                  <p className="text-xs text-fg3">
                    Práctica con un prospecto
                  </p>
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    <Link href="/" className="inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-fg3 hover:text-fg1 lg:h-7 lg:min-h-0 lg:min-w-0 lg:px-2">
                      Inicio
                    </Link>
                    <span className="text-fg3">·</span>
                    <Link href="/coach" className="inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-fg3 hover:text-fg1 lg:h-7 lg:min-h-0 lg:min-w-0 lg:px-2">
                      Coach
                    </Link>
                    <span className="text-fg3">·</span>
                    <Link href="/llamadas" className="inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-fg3 hover:text-fg1 lg:h-7 lg:min-h-0 lg:min-w-0 lg:px-2">
                      Llamadas
                    </Link>
                    <span className="text-fg3">·</span>
                    <Link href="/crm" className="inline-flex h-11 min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-fg3 hover:text-fg1 lg:h-7 lg:min-h-0 lg:min-w-0 lg:px-2">
                      CRM
                    </Link>
                  </div>
                </SidebarHeader>
                <SidebarContent className="px-4">
                  <Suspense fallback={null}>
                    <TrainingSetupForm />
                  </Suspense>
                </SidebarContent>
                <SidebarFooter className="p-4">
                  <ThemeToggle />
                </SidebarFooter>
              </Sidebar>
              <SidebarInset className="pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">{children}</SidebarInset>
            </SidebarProvider>
            <PracticeTabBar />
          </RoomWrapper>
        </TooltipProvider>
      </ConnectionProvider>
    </TrainingProvider>
  );
}
