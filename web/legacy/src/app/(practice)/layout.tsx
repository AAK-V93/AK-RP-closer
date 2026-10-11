import { ConnectionProvider } from "@/hooks/use-connection";
import { TrainingProvider } from "@/hooks/use-training-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoomWrapper } from "@/components/room-wrapper";
import { PracticeReadyGate } from "@/components/practice-ready-gate";
import { PracticeShell } from "@/components/practice-tab-bar";

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
            <PracticeShell>{children}</PracticeShell>
          </RoomWrapper>
        </TooltipProvider>
      </ConnectionProvider>
    </TrainingProvider>
  );
}
