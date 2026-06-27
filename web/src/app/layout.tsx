import "./globals.css";
import { TrainingProvider } from "@/hooks/use-training-state";
import { ConnectionProvider } from "@/hooks/use-connection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Roboto } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
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

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["100", "300", "400", "500", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

import "@livekit/components-styles";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={roboto.className}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <TrainingProvider>
            <ConnectionProvider>
              <TooltipProvider>
                <RoomWrapper>
                  <SidebarProvider defaultOpen={true}>
                    <Sidebar className="bg-bg1">
                      <SidebarHeader className="px-4 py-3">
                        <div className="text-sm font-semibold tracking-tight">
                          Closer Trainer
                        </div>
                        <p className="text-xs text-fg3">
                          Simulador de prospectos con IA
                        </p>
                      </SidebarHeader>
                      <SidebarContent className="px-4">
                        <TrainingSetupForm />
                      </SidebarContent>
                      <SidebarFooter className="p-4">
                        <ThemeToggle />
                      </SidebarFooter>
                    </Sidebar>
                    <SidebarInset>
                      {children}
                      <Toaster />
                    </SidebarInset>
                  </SidebarProvider>
                </RoomWrapper>
              </TooltipProvider>
            </ConnectionProvider>
          </TrainingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
