import type { Db } from "./dto";

/** Currency and zone every metric needs. One row, two columns. */
export async function readUserSettings(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { currency: true, timezone: true },
  });
  return { currency: user?.currency ?? "USD", timezone: user?.timezone ?? "America/Bogota" };
}
