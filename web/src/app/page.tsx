import { Suspense } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { AppShell } from "@/components/app-shell";
import { HomeScreen } from "@/components/home-screen";
import { HomeSkeleton } from "@/components/page-skeleton";
import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";
import { hubSnapshot } from "@/app/api/hub/route";
import { getWorkspacePrisma } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function GuestHome() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-4xl text-fg0">Entrena con tus llamadas reales</h1>
        <p className="text-sm text-fg3">
          Conectas tus grabaciones o subes transcripciones. El agente de voz de práctica
          emula a tus prospectos, el coach te corrige y el CRM te dice con quién
          quedar.
        </p>
      </div>
      <Button asChild variant="primary">
        <Link href="/login?mode=register&callbackUrl=/">Empezar</Link>
      </Button>
    </div>
  );
}

async function HomeFromDb({ userId }: { userId: string }) {
  const prisma = await getWorkspacePrisma();
  if (!prisma) return <HomeScreen />;
  try {
    const snapshot = JSON.parse(JSON.stringify(await hubSnapshot(prisma, userId)));
    return <HomeScreen initialSnapshot={snapshot} />;
  } catch (error) {
    console.error("home page", error);
    return <HomeScreen />;
  }
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  return (
    <AppShell>
      {userId ? (
        <Suspense fallback={<HomeSkeleton />}>
          <HomeFromDb userId={userId} />
        </Suspense>
      ) : (
        <GuestHome />
      )}
    </AppShell>
  );
}
