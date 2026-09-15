import type { PrismaClient } from "@prisma/client";
import type { CommissionRuleInput } from "@/lib/offer-commercial";
import { defaultCommissionRule } from "@/lib/offer-commercial";

export function periodStart(
  periodo: CommissionRuleInput["periodoAcumulacion"],
  at: Date,
) {
  if (periodo === "total") return new Date(0);
  if (periodo === "anual") return new Date(Date.UTC(at.getUTCFullYear(), 0, 1));
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** Comisión sobre `amount`, respetando el salto de tramo del acumulado previo. */
export function commissionOnAmount(args: {
  rule: CommissionRuleInput;
  accumulatedBefore: number;
  amount: number;
}) {
  const { rule, amount } = args;
  if (amount <= 0) return { pct: rule.pctBase, generada: 0 };
  const before = Math.max(0, args.accumulatedBefore);
  const umbral = rule.umbralAcumuladoUsd;
  if (before >= umbral) {
    return { pct: rule.pctSobreUmbral, generada: amount * rule.pctSobreUmbral };
  }
  const room = umbral - before;
  if (amount <= room) {
    return { pct: rule.pctBase, generada: amount * rule.pctBase };
  }
  const low = room * rule.pctBase;
  const high = (amount - room) * rule.pctSobreUmbral;
  const generada = low + high;
  return { pct: generada / amount, generada };
}

export function pickRule(
  rules: CommissionRuleInput[],
  fallback?: CommissionRuleInput | null,
): CommissionRuleInput {
  return rules[0] || fallback || defaultCommissionRule();
}

export async function persistCommissionRule(
  prisma: PrismaClient,
  userId: string,
  offerId: string,
  rule: CommissionRuleInput | null,
) {
  if (!rule) return;
  const existing = await prisma.commissionRule.findFirst({ where: { userId, offerId } });
  const data = {
    pctBase: rule.pctBase,
    umbralAcumuladoUsd: rule.umbralAcumuladoUsd,
    pctSobreUmbral: rule.pctSobreUmbral,
    base: rule.base,
    periodoAcumulacion: rule.periodoAcumulacion,
  };
  if (existing) {
    await prisma.commissionRule.update({ where: { id: existing.id }, data });
    return;
  }
  await prisma.commissionRule.create({ data: { userId, offerId, ...data } });
}
