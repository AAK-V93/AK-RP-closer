import Link from "next/link";

const LINKS = [
  { href: "/", label: "Hoy", key: "hoy" },
  { href: "/metas", label: "Metas", key: "metas" },
  { href: "/ofertas", label: "Mis ofertas", key: "ofertas" },
] as const;

function initials(name: string | null, email: string | null) {
  const src = (name || email || "").trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

export function V2Nav({ current, name, email }: { current: (typeof LINKS)[number]["key"]; name: string | null; email: string | null }) {
  return (
    <nav className="nav">
      <Link href="/" className="brand">Closer Trainer</Link>
      <div className="navlinks">
        {LINKS.map((l) => (
          <Link key={l.key} href={l.href} className={l.key === current ? "on" : undefined}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="navright">
        <span className="avatar" title={name ?? email ?? undefined}>{initials(name, email)}</span>
      </div>
    </nav>
  );
}
