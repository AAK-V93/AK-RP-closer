"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Home, Mic, MoreHorizontal, Phone, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  MORE_LINKS,
  avatarLetter,
  moreActive,
  navActive,
  visibleTabs,
} from "@/lib/mobile-nav";

const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/llamadas", label: "Llamadas" },
  { href: "/practicar", label: "Práctica" },
  { href: "/coach", label: "Coach" },
  { href: "/crm", label: "CRM", crm: true },
  { href: "/ofertas", label: "Ofertas" },
  { href: "/biblioteca", label: "Biblioteca" },
];

const TAB_ICONS: Record<string, typeof Home> = {
  "/": Home,
  "/llamadas": Phone,
  "/practicar": Mic,
  "/crm": Users,
};

const TAB_CLASS =
  "flex h-16 min-w-0 flex-col items-center justify-center gap-1 text-[11px] text-fg3 aria-[current=page]:font-semibold aria-[current=page]:text-fg0";

/** Fixed bottom tab bar, phones only. The desktop keeps the top pill menu. */
function MobileTabBar({ path, showCrm }: { path: string; showCrm: boolean }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = visibleTabs(showCrm);
  const onMore = moreActive(path);
  useEffect(() => {
    setMoreOpen(false);
  }, [path]);
  return (
    <>
      <nav
        aria-label="Menú"
        className="fixed inset-x-0 bottom-0 z-40 min-w-0 max-w-full border-t border-separator1 bg-bg1 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul
          className="grid min-w-0"
          style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.href] || Home;
            const active = navActive(path, tab.href);
            return (
              <li key={tab.href} className="min-w-0">
                <Link href={tab.href} aria-current={active ? "page" : undefined} className={TAB_CLASS}>
                  <Icon aria-hidden className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 2} />
                  {tab.label}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-current={onMore ? "page" : undefined}
              onClick={() => setMoreOpen(true)}
              className={`${TAB_CLASS} w-full`}
            >
              <MoreHorizontal aria-hidden className="h-[22px] w-[22px]" strokeWidth={onMore ? 2.3 : 2} />
              Más
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-separator1 bg-bg1 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 md:hidden"
        >
          <SheetTitle className="font-display text-xl text-fg0">Más</SheetTitle>
          <SheetDescription className="sr-only">Coach, Ofertas y Biblioteca</SheetDescription>
          <ul className="divide-y divide-separator1 border-t border-separator1">
            {MORE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={navActive(path, link.href) ? "page" : undefined}
                  className="flex h-14 items-center text-base text-fg0 aria-[current=page]:font-semibold"
                  onClick={() => setMoreOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}

function UserMenu({ name, email }: { name?: string | null; email?: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Tu cuenta"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full border border-separator1 bg-bg2 text-[13px] font-semibold text-fg2">
            {avatarLetter(name, email)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {email && <DropdownMenuLabel className="truncate text-xs font-normal text-fg3">{email}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => void signOut({ callbackUrl: "/" })}>
          Salir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  const signedIn = status === "authenticated";

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
  // Room for the fixed tab bar and the iPhone home indicator. Desktop keeps py-6.
  const tabPadding = signedIn ? " pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6" : "";

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
            {signedIn ? (
              <UserMenu name={data?.user?.name} email={data?.user?.email} />
            ) : (
              <Button asChild variant="ghost" size="sm" className="text-tone-info">
                <Link href="/login">Entrar</Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main
        className={
          (wide
            ? "min-w-0 w-full max-w-full flex-1 overflow-x-clip px-4 md:px-8 py-6"
            : "mx-auto min-w-0 w-full max-w-3xl flex-1 overflow-x-clip px-4 md:px-6 py-6") + tabPadding
        }
      >
        {children}
      </main>
      {signedIn && <MobileTabBar path={path} showCrm={showCrm} />}
    </div>
  );
}
