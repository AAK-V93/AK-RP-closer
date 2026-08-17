"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function AuthMenu() {
  const { data, status } = useSession();
  const path = usePathname();
  const showHome = path !== "/";

  if (status === "loading") {
    return <span className="text-xs text-fg3">…</span>;
  }

  const homeLink = showHome ? (
    <Button asChild variant="ghost" size="sm">
      <Link href="/">Inicio</Link>
    </Button>
  ) : null;

  if (!data?.user) {
    return (
      <div className="flex items-center gap-2">
        {homeLink}
        <Button asChild variant="outline" size="sm">
          <Link href="/coach">Mi coaching</Link>
        </Button>
        <Button asChild variant="primary" size="sm">
          <Link href="/login">Entrar</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      {homeLink}
      <Button asChild variant="outline" size="sm">
        <Link href="/coach">Mi coaching</Link>
      </Button>
      <span className="text-xs text-fg3 truncate hidden sm:inline max-w-[160px]">
        {data.user.email}
      </span>
      <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}>
        Salir
      </Button>
    </div>
  );
}
