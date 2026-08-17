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
            <SidebarProvider defaultOpen={true}>
              <Sidebar className="bg-bg1">
                <SidebarHeader className="px-4 py-3">
                  <Link href="/" className="text-sm font-semibold tracking-tight">
                    Closer Trainer
                  </Link>
                  <p className="text-xs text-fg3">
                    Práctica con un prospecto
                  </p>
                </SidebarHeader>
                <SidebarContent className="px-4">
                  <TrainingSetupForm />
                </SidebarContent>
                <SidebarFooter className="p-4">
                  <ThemeToggle />
                </SidebarFooter>
              </Sidebar>
              <SidebarInset>{children}</SidebarInset>
            </SidebarProvider>
          </RoomWrapper>
        </TooltipProvider>
      </ConnectionProvider>
    </TrainingProvider>
  );
}
