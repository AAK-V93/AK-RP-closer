"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/llamadas", label: "Llamadas" },
  { href: "/practicar", label: "Práctica" },
  { href: "/coach", label: "Coach" },
  { href: "/crm", label: "CRM", crm: true },
  { href: "/ofertas", label: "Ofertas" },
  { href: "/biblioteca", label: "Biblioteca" },
];

export function AppShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  const path = usePathname();
  const { data, status } = useSession();
  const [showCrm, setShowCrm] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/workspace")
      .then((r) => r.json())
      .then((payload) => {
        if (typeof payload.showCrm === "boolean") setShowCrm(payload.showCrm);
      })
      .catch(() => undefined);
  }, [status, path]);

  const items = NAV.filter((item) => !item.crm || showCrm);

  return (
    <div className="min-h-screen bg-bg0 flex flex-col">
      <header className="border-b border-separator1">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
          <Link href="/" className="font-display text-lg shrink-0">
            Closer Trainer
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? path === "/"
                  : path === item.href || path.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    active
                      ? "rounded-full bg-bg2 px-3 py-1 text-tone-info"
                      : "rounded-full px-3 py-1 text-tone-info/80 hover:text-tone-info"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            {status === "authenticated" ? (
              <>
                <span className="text-xs text-fg3 truncate hidden sm:inline max-w-[140px]">
                  {data?.user?.email}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => signOut({ callbackUrl: "/" })}
                >
                  Salir
                </Button>
              </>
            ) : (
              <Button asChild variant="ghost" size="sm" className="text-tone-info">
                <Link href="/login">Entrar</Link>
              </Button>
            )}
          </div>
        </div>
        <nav className="md:hidden flex gap-1 overflow-x-auto px-3 pb-2 text-xs">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full border border-separator1 px-2.5 py-1 text-tone-info"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main
        className={
          wide
            ? "flex-1 w-full px-4 md:px-8 py-6"
            : "flex-1 max-w-3xl w-full mx-auto px-4 md:px-6 py-6"
        }
      >
        {children}
      </main>
    </div>
  );
}
