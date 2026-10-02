import type { ExtractedOffer } from "@/lib/offer-commercial";

type PlacedText = { str: string; x: number; y: number };

const COMMISSION_CUE = /comisi[oó]n(?:\s+del\s+closer)?|pago\s+al\s+closer/i;

/** A thousands-dotted amount must not swallow digits that belong to the next token. */
export function separateMoneyTokens(text: string) {
  return text.replace(/(\d{1,3}(?:\.\d{3})+)(?=\d)/g, "$1\n");
}

export function parseSpanishMoneyToken(token: string): number | null {
  const raw = token.trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  if (/^\d{1,3}(,\d{3})+$/.test(raw)) return Number(raw.replace(/,/g, ""));
  if (/^\d+$/.test(raw)) return Number(raw);
  return null;
}

/** USD amounts, one line at a time, so "1.997" and the next line's "69" stay apart. */
export function moneyAmountsInText(text: string): number[] {
  const found: number[] = [];
  for (const line of separateMoneyTokens(text).split(/\n/)) {
    const re = /(?:USD|US\$|\$)\s*(\d{1,3}(?:\.\d{3})+|\d{1,7})(?![\d.])/gi;
    for (const match of line.matchAll(re)) {
      const amount = parseSpanishMoneyToken(match[1] || "");
      if (amount != null && amount > 0) found.push(amount);
    }
  }
  return found;
}

export function linesFromTextItems(items: { str?: string; transform?: number[] }[]) {
  const rows: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of items) {
    const str = item.str;
    const transform = item.transform;
    if (!str?.trim() || !transform) continue;
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, str });
  }
  rows.sort((a, b) => b.y - a.y);
  return separateMoneyTokens(
    rows
      .map((row) => joinLineParts(row.parts))
      .filter(Boolean)
      .join("\n"),
  );
}

function joinLineParts(parts: { x: number; str: string }[]) {
  const ordered = [...parts].sort((a, b) => a.x - b.x);
  let line = "";
  for (const part of ordered) {
    const piece = part.str.trim();
    if (!piece) continue;
    if (!line) {
      line = piece;
      continue;
    }
    const prev = line.trimEnd();
    if (/\d{1,3}(?:\.\d{3})+$/.test(prev) && /^\d/.test(piece)) {
      line += `\n${piece}`;
      continue;
    }
    line += `${prev.endsWith(" ") ? "" : " "}${piece}`;
  }
  return line;
}

function placedItems(items: { str?: string; transform?: number[] }[]): PlacedText[] {
  return items
    .filter((item) => item.str?.trim() && item.transform)
    .map((item) => ({
      str: item.str!.trim(),
      x: item.transform![4] ?? 0,
      y: item.transform![5] ?? 0,
    }));
}

/**
 * Pair each USD amount with the price label in the same column, above it.
 * A left-to-right reading order would stick "Precio regular" onto USD 1.597.
 */
export function explicitPriceLines(items: { str?: string; transform?: number[] }[]) {
  const placed = placedItems(items);
  const lines: string[] = [];
  for (const item of placed) {
    const money = item.str.match(/^(?:USD|US\$|\$)\s*(\d{1,3}(?:\.\d{3})+|\d{1,7})$/i);
    if (!money) continue;
    const sameLine = placed
      .filter(
        (other) =>
          Math.abs(other.y - item.y) <= 3 &&
          other.x < item.x &&
          /cuota/i.test(other.str),
      )
      .sort((a, b) => b.x - a.x)[0];
    if (sameLine) {
      const count = sameLine.str.match(/(\d{1,2})\s*cuotas?/i);
      lines.push(`${count ? `${count[1]} cuotas de` : "Cuotas"}: USD ${money[1]}`);
      continue;
    }
    const above = placed
      .filter(
        (other) =>
          other.y >= item.y + 8 &&
          Math.abs(other.x - item.x) <= 140 &&
          /precio|regular|especial|lista/i.test(other.str) &&
          other.str.length <= 80,
      )
      .sort((a, b) => a.y - b.y)[0];
    if (above) lines.push(`${above.str}: USD ${money[1]}`);
    else lines.push(`USD ${money[1]}`);
  }
  return lines;
}

export type CitedPrice = { label: string; amount: number; list?: boolean };

function priceLabel(line: string, previous: string, sameLine: boolean) {
  const blob = sameLine ? line : `${previous}\n${line}`;
  const cuota = blob.match(/(\d{1,2})\s*cuotas?\s+de/i);
  if (cuota && /USD|\$/i.test(line)) return { label: `${cuota[1]} cuotas de`, list: false };
  if (/precio\s+especial|\bespecial\b/i.test(sameLine ? line : blob) && /USD|\$/i.test(line)) {
    return { label: "Precio especial", list: false };
  }
  if (/precio\s+regular|\bregular\b/i.test(sameLine ? line : previous)) {
    return { label: "Precio regular", list: false };
  }
  if (/precio\s+de\s+lista|\blista\b/i.test(sameLine ? line : previous)) {
    return { label: "Precio de lista", list: true };
  }
  if (/contado/i.test(sameLine ? line : previous)) return { label: "Contado", list: false };
  return { label: "Precio", list: false };
}

export function pricesFromOfferText(text: string): {
  listPrice: number | null;
  altPrices: { label: string; amount: number }[];
} {
  const lines = separateMoneyTokens(text).split(/\n/);
  const hits: { label: string; amount: number; list: boolean; sameLine: boolean }[] = [];
  const remember = (label: string, amount: number, list: boolean, sameLine: boolean) => {
    const existing = hits.find((row) => row.amount === amount);
    if (!existing) {
      hits.push({ label, amount, list, sameLine });
      return;
    }
    if (sameLine && !existing.sameLine) {
      existing.label = label;
      existing.list = list;
      existing.sameLine = true;
    } else if (existing.label === "Precio" && label !== "Precio") {
      existing.label = label;
      existing.list = list;
    }
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const previous = (lines[index - 1] || "").trim();
    const re = /(?:USD|US\$|\$)\s*(\d{1,3}(?:\.\d{3})+|\d{1,7})(?![\d.])/gi;
    for (const match of line.matchAll(re)) {
      const amount = parseSpanishMoneyToken(match[1] || "");
      if (amount == null) continue;
      const sameLine = /precio|regular|especial|lista|cuota|contado/i.test(line);
      const named = priceLabel(line, sameLine ? "" : previous, sameLine);
      remember(named.label, amount, named.list, sameLine);
    }
  }
  const list = hits.find((row) => row.list);
  const altPrices = hits
    .filter((row) => row.amount !== list?.amount)
    .map((row) => ({ label: row.label, amount: row.amount }));
  return { listPrice: list?.amount ?? null, altPrices };
}

/** A percent is commission only when it sits on the comisión / pago al closer line. */
export function commissionCitedInSource(text: string): { pct: number; snippet: string } | null {
  const cue = /comisi[oó]n(?:\s+del\s+closer)?|pago\s+al\s+closer/gi;
  let found: RegExpExecArray | null;
  while ((found = cue.exec(text))) {
    const lineStart = text.lastIndexOf("\n", Math.max(0, found.index - 1)) + 1;
    const lineEndIdx = text.indexOf("\n", found.index);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const line = text.slice(lineStart, lineEnd);
    const onLine = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (onLine) {
      return { pct: Number(onLine[1].replace(",", ".")), snippet: line.trim() };
    }
    const nextEndIdx = text.indexOf("\n", lineEnd + 1);
    const next = text.slice(lineEnd + 1, nextEndIdx === -1 ? text.length : nextEndIdx).trim();
    const onlyPct = next.match(/^(\d+(?:[.,]\d+)?)\s*%/);
    if (onlyPct && !/éxito|exito|probabilidad|casos/i.test(next)) {
      return { pct: Number(onlyPct[1].replace(",", ".")), snippet: `${line.trim()} ${next}`.trim() };
    }
  }
  return null;
}

function pctPoints(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1 ? value : value * 100;
}

export function guardOfferContent(offer: ExtractedOffer, sourceText: string): ExtractedOffer {
  const source = separateMoneyTokens(sourceText);
  const cited = new Set(moneyAmountsInText(source));
  const fromText = pricesFromOfferText(source);
  const commercial = {
    ...offer.commercial,
    altPrices: offer.commercial.altPrices.map((row) => ({ ...row })),
    commission: offer.commercial.commission
      ? { ...offer.commercial.commission, tiers: [...offer.commercial.commission.tiers] }
      : null,
  };

  if (fromText.altPrices.length || fromText.listPrice != null) {
    commercial.listPrice = fromText.listPrice;
    commercial.altPrices = fromText.altPrices;
  } else {
    if (commercial.listPrice != null && !cited.has(Math.round(commercial.listPrice))) {
      commercial.listPrice = null;
    }
    commercial.altPrices = commercial.altPrices.filter(
      (row) => row.amount == null || cited.has(Math.round(row.amount)),
    );
  }

  const citedCommission = commissionCitedInSource(source);
  if (!citedCommission || !commercial.commission) {
    commercial.commission = null;
  } else {
    const modelPct = pctPoints(commercial.commission.pctBase);
    const tierOk = commercial.commission.tiers.filter(
      (tier) => tier.pct != null && Math.abs(pctPoints(tier.pct) - citedCommission.pct) <= 0.6,
    );
    if (modelPct && Math.abs(modelPct - citedCommission.pct) > 0.6 && !tierOk.length) {
      commercial.commission = null;
    } else {
      const pct = citedCommission.pct > 1 ? citedCommission.pct / 100 : citedCommission.pct;
      commercial.commission = {
        ...commercial.commission,
        notes: citedCommission.snippet,
        tiers: tierOk,
        pctBase: pct,
        pctSobreUmbral: pct,
      };
    }
  }

  return { ...offer, commercial };
}

export function sanitizeCommissionQuestions(questions: string[], sourceText: string) {
  const cited = commissionCitedInSource(sourceText);
  return questions.map((question) => {
    if (!COMMISSION_CUE.test(question)) return question;
    const pct = question.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (!pct) return question;
    const value = Number(pct[1].replace(",", "."));
    if (cited && Math.abs(value - cited.pct) <= 0.6) return question;
    return "No encontré un porcentaje de comisión. ¿La dejo vacía?";
  });
}
