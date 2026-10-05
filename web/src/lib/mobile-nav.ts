/** Phone tab bar. Coach, Ofertas and Biblioteca live in the «Más» sheet. */
export type MobileTab = { href: string; label: string; crm?: boolean };

export const MOBILE_TABS: MobileTab[] = [
  { href: "/", label: "Inicio" },
  { href: "/llamadas", label: "Llamadas" },
  { href: "/practicar", label: "Práctica" },
  { href: "/crm", label: "CRM", crm: true },
];

export const MORE_LINKS: MobileTab[] = [
  { href: "/coach", label: "Coach" },
  { href: "/ofertas", label: "Ofertas" },
  { href: "/biblioteca", label: "Biblioteca" },
];

export function navActive(path: string, href: string) {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

/** The tabs shown for this closer. CRM only once it exists, like the top menu. */
export function visibleTabs(showCrm: boolean) {
  return MOBILE_TABS.filter((tab) => !tab.crm || showCrm);
}

/** «Más» is the active tab while the closer is on one of its pages. */
export function moreActive(path: string) {
  return MORE_LINKS.some((link) => navActive(path, link.href));
}

/** One letter for the header avatar: the name, else the email. */
export function avatarLetter(name?: string | null, email?: string | null) {
  const source = String(name || "").trim() || String(email || "").trim();
  return source ? source.charAt(0).toLocaleUpperCase("es") : "?";
}
