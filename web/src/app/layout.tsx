import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Fraunces, Public_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthSessionProvider } from "@/components/auth-session-provider";
import { authOptions } from "@/lib/auth";
import { VersionNotice } from "@/components/version-notice";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fraunces",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-public",
  display: "swap",
});

import "@livekit/components-styles";

export const metadata: Metadata = {
  title: "Closer Trainer",
  description: "Práctica de cierre, CRM y pendientes del closer.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Closer Trainer" },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#F2ECE1",
  // Lets the phone tab bar pad itself with env(safe-area-inset-bottom).
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${fraunces.variable} ${publicSans.variable} overflow-x-clip`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <AuthSessionProvider session={session}>
            {children}
            <Toaster />
            <VersionNotice />
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
