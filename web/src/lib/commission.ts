import type { PrismaClient } from "@prisma/client";
import type { CommissionRuleInput, CommissionTier } from "@/lib/offer-commercial";
import { defaultCommissionRule } from "@/lib/offer-commercial";

export function periodStart(
  periodo: CommissionRuleInput["periodoAcumulacion"],
  at: Date,
) {
  if (periodo === "total") return new Date(0);
  if (periodo === "anual") return new Date(Date.UTC(at.getUTCFullYear(), 0, 1));
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

function haystack(tier: CommissionTier) {
  return `${tier.label} ${tier.when} ${tier.paymentMode}`.toLowerCase();
}

export function resolveCommissionPct(
  rule: CommissionRuleInput,
  modoPago?: string | null,
): number {
  const needle = String(modoPago || "").trim().toLowerCase();
  if (rule.tiers.length) {
    if (needle) {
      const hit = rule.tiers.find((tier) => {
        const hay = haystack(tier);
        if (!hay.trim()) return false;
        return (
          hay.includes(needle) ||
          needle.includes(tier.paymentMode.toLowerCase()) ||
          needle.includes(tier.label.toLowerCase()) ||
          (tier.when && needle.includes(tier.when.toLowerCase()))
        );
      });
      if (hit?.pct != null) return hit.pct;
    }
    const withPct = rule.tiers.find((tier) => tier.pct != null);
    if (withPct?.pct != null) return withPct.pct;
  }
  return rule.pctBase || 0;
}

/** Comisión sobre `amount`. Si hay tramos por forma/plazo de pago, usa esos. El umbral de volumen solo si está definido. */
export function commissionOnAmount(args: {
  rule: CommissionRuleInput;
  accumulatedBefore: number;
  amount: number;
  modoPago?: string | null;
}) {
  const { rule, amount } = args;
  const pct = resolveCommissionPct(rule, args.modoPago);
  if (amount <= 0) return { pct, generada: 0 };
  const umbral = rule.umbralAcumuladoUsd;
  if (rule.tiers.length || !umbral || umbral <= 0) {
    return { pct, generada: amount * pct };
  }
  const before = Math.max(0, args.accumulatedBefore);
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
    pctBase: resolveCommissionPct(rule, null) || rule.pctBase,
    umbralAcumuladoUsd: rule.tiers.length ? 0 : rule.umbralAcumuladoUsd,
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
