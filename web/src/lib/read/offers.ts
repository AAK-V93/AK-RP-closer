// Offer map for names and commission (cached apart, tag offers): no join per row.
import { type Db, amount } from "./dto";

export const OFFERS_TAKE = 20;

export async function readOfferMap(db: Db, userId: string) {
  const rows = await db.offer.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: OFFERS_TAKE,
    select: { id: true, name: true, currency: true, priceCash: true, commissionType: true, commissionValue: true },
  });
  return rows.map((o) => ({ ...o, priceCash: amount(o.priceCash), commissionValue: amount(o.commissionValue) }));
}
