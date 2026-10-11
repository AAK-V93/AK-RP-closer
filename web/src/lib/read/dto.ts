// Readers return plain JSON (strings for dates and money) so the result can
// go through unstable_cache, which serializes it, and still look the same.
export type Iso = string;
export type Amount = string; // Decimal(12,2) as text

export const iso = (d: Date | null | undefined): Iso | null => (d ? d.toISOString() : null);
export const amount = (v: { toString(): string } | null | undefined): Amount | null => (v == null ? null : v.toString());

export type Db = import("@prisma/client").PrismaClient;
