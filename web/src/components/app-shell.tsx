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
    fetch("/api/workspace?view=nav")
      .then((r) => r.json())
      .then((payload) => {
        if (typeof payload.showCrm === "boolean") setShowCrm(payload.showCrm);
      })
      .catch(() => undefined);
  }, [status, path]);

  const items = NAV.filter((item) => !item.crm || showCrm);

  return (
    <div className="flex min-h-screen w-full min-w-0 max-w-full flex-col overflow-x-clip bg-bg0">
      <header className="min-w-0 max-w-full border-b border-separator1">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3">
          <Link href="/" className="inline-flex h-11 min-h-[44px] shrink-0 items-center font-display text-lg">
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
                      ? "inline-flex h-11 min-h-[44px] items-center rounded-full bg-bg2 px-3 text-tone-info"
                      : "inline-flex h-11 min-h-[44px] items-center rounded-full px-3 text-tone-info/80 hover:text-tone-info"
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
        <nav className="relative min-w-0 max-w-full md:hidden">
          <div className="flex w-full min-w-0 max-w-full gap-1 overflow-x-auto px-3 pb-2 text-xs [scrollbar-width:thin]">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex h-11 min-h-[44px] shrink-0 items-center rounded-full border border-separator1 px-3 text-tone-info"
                style={{ minHeight: 44, height: 44 }}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg0 to-transparent"
          />
        </nav>
      </header>
      <main
        className={
          wide
            ? "min-w-0 w-full max-w-full flex-1 overflow-x-clip px-4 md:px-8 py-6"
            : "mx-auto min-w-0 w-full max-w-3xl flex-1 overflow-x-clip px-4 md:px-6 py-6"
        }
      >
        {children}
      </main>
    </div>
  );
}
