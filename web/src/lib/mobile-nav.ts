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

/** A real display name. A single letter, a blank, or an email is not one. */
export function displayNameOf(name?: string | null) {
  const text = String(name || "").trim();
  if (!text || text.length < 2) return "";
  if (text.includes("@")) return "";
  if (/^(null|undefined|user|usuario|closer)$/i.test(text)) return "";
  return text;
}

/** The words the account menu and the avatar share. Display name, else the email. */
export function accountIdentity(name?: string | null, email?: string | null) {
  const display = displayNameOf(name);
  const mail = String(email || "").trim();
  return display || mail;
}

/** Hide the phone tab bar while a practice session is connected or recording. */
export function showPracticeTabBar(args: {
  phase: string;
  shouldConnect: boolean;
  isConnecting: boolean;
}) {
  if (args.shouldConnect || args.isConnecting) return false;
  if (args.phase === "preparing" || args.phase === "audio" || args.phase === "ready") return false;
  return true;
}

/** One letter for the header avatar: the display name, else the email. */
export function avatarLetter(name?: string | null, email?: string | null) {
  const source = accountIdentity(name, email);
  const local = source.includes("@") ? source.split("@")[0] : source;
  const letter = local.replace(/^[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/, "").charAt(0);
  return letter ? letter.toLocaleUpperCase("es") : "?";
}
