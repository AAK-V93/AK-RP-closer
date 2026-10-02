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
  if (/precio\s+especial|\bespecial\b|lanzamiento/i.test(sameLine ? line : blob) && /USD|\$/i.test(line)) {
    return { label: "Precio especial", list: false };
  }
  if (/contado/i.test(sameLine ? line : previous)) return { label: "Contado", list: false };
  if (/precio\s+regular|\bregular\b/i.test(sameLine ? line : previous)) {
    return { label: "Precio regular", list: true };
  }
  if (/precio\s+de\s+lista|\blista\b/i.test(sameLine ? line : previous)) {
    return { label: "Precio de lista", list: true };
  }
  return { label: "Precio", list: false };
}

function rememberPrice(
  hits: { label: string; amount: number; list: boolean; sameLine: boolean }[],
  label: string,
  amount: number,
  list: boolean,
  sameLine: boolean,
) {
  const existing = hits.find((row) => row.amount === amount);
  if (!existing) {
    hits.push({ label, amount, list, sameLine });
    return;
  }
  if (sameLine && !existing.sameLine) {
    existing.label = label;
    existing.list = list;
    existing.sameLine = true;
    return;
  }
  if (existing.label === "Precio" && label !== "Precio") {
    existing.label = label;
    existing.list = list;
  }
}

export function pricesFromOfferText(text: string): {
  listPrice: number | null;
  altPrices: { label: string; amount: number }[];
} {
  const lines = separateMoneyTokens(text)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hits: { label: string; amount: number; list: boolean; sameLine: boolean }[] = [];
  const moneyRe = /(?:USD|US\$|\$)\s*(\d{1,3}(?:\.\d{3})+|\d{1,7})(?![\d.])/i;
  for (const line of lines) {
    const match = line.match(moneyRe);
    if (!match || !/precio|regular|especial|lista|cuota|contado|lanzamiento/i.test(line)) continue;
    const amount = parseSpanishMoneyToken(match[1] || "");
    if (amount == null) continue;
    const named = priceLabel(line, "", true);
    rememberPrice(hits, named.label, amount, named.list, true);
  }
  // Two-column PDFs often list the labels, then the amounts, in the same order.
  let pending: string[] = [];
  for (const line of lines) {
    if (/^precio\s+(especial|regular|de lista)\b/i.test(line) && !moneyRe.test(line)) {
      pending.push(line);
      continue;
    }
    const only = line.match(/^(?:USD|US\$|\$)\s*(\d{1,3}(?:\.\d{3})+|\d{1,7})$/i);
    if (only && pending.length) {
      const amount = parseSpanishMoneyToken(only[1] || "");
      const labelLine = pending.shift() || "";
      if (amount != null) {
        const named = priceLabel(`${labelLine}: ${line}`, "", true);
        rememberPrice(hits, named.label, amount, named.list, true);
      }
      continue;
    }
    if (!only) pending = [];
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";
    const match = line.match(moneyRe);
    if (!match) continue;
    const amount = parseSpanishMoneyToken(match[1] || "");
    if (amount == null || hits.some((row) => row.amount === amount)) continue;
    const previous = lines[index - 1] || "";
    const named = priceLabel(line, previous, false);
    rememberPrice(hits, named.label, amount, named.list, false);
  }
  const list = hits.find((row) => row.list);
  const altPrices = hits
    .filter((row) => row.amount !== list?.amount)
    .map((row) => ({ label: row.label, amount: row.amount }));
  return { listPrice: list?.amount ?? null, altPrices };
}

/** Right-hand "Bonus incluidos" column. Wrapped lines that start lowercase stay with the bonus above. */
export function explicitBonusLines(items: { str?: string; transform?: number[] }[]) {
  const placed = placedItems(items);
  const header = placed.find((item) => /^bonus incluidos$/i.test(item.str));
  if (!header) return [];
  const nucleus = placed.find((item) => /n[uú]cleo del programa/i.test(item.str));
  const splitX = nucleus ? (nucleus.x + header.x) / 2 : header.x - 80;
  const rows: { y: number; parts: { x: number; str: string }[] }[] = [];
  for (const item of placed) {
    if (item.y > header.y - 8) continue;
    if (item.x < splitX) continue;
    if (item.y < header.y - 320) continue;
    if (/garant[ií]a|^bonus incluidos$/i.test(item.str)) continue;
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
    if (!row) {
      row = { y: item.y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x: item.x, str: item.str });
  }
  rows.sort((a, b) => b.y - a.y);
  const bonuses: string[] = [];
  for (const row of rows) {
    const line = row.parts
      .sort((a, b) => a.x - b.x)
      .map((part) => part.str.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    if (/^[a-záéíóúñ]/.test(line) && bonuses.length) {
      bonuses[bonuses.length - 1] = `${bonuses[bonuses.length - 1]} ${line}`;
      continue;
    }
    bonuses.push(line);
  }
  return bonuses.map((name) => `Bonus: ${name}`);
}

const BONUS_SECTION_END =
  /garant[ií]a\s+total|tasa de [eé]xito|tu pr[oó]ximo paso|^casos reales\b/i;

function uniqueBonusNames(names: string[]) {
  const unique: string[] = [];
  for (const name of names) {
    const cleaned = name.replace(/\s+/g, " ").trim();
    if (cleaned.length < 8) continue;
    if (/^no es un bonus\b/i.test(cleaned)) continue;
    if (!unique.some((row) => row.toLowerCase() === cleaned.toLowerCase())) unique.push(cleaned);
  }
  return unique;
}

/**
 * Production unpdf `extractText({mergePages:true})` puts a heading line
 * "Bonus incluidos", then one bonus per line (wrapped lines start lowercase),
 * then "GARANTÍA TOTAL". That heading is not a "Bonus:" prefix, and
 * "No es un bonus." earlier in the doc is not this section.
 */
export function bonusesFromOfferText(text: string): { name: string; condition: string }[] {
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const start = lines.findIndex((line) => /^bonus incluidos$/i.test(line));
  if (start >= 0) {
    const names: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (BONUS_SECTION_END.test(line)) break;
      if (/^no es un bonus\b/i.test(line)) continue;
      if (/^[a-záéíóúñü]/.test(line) && names.length) {
        names[names.length - 1] = `${names[names.length - 1]} ${line}`;
        continue;
      }
      names.push(line);
    }
    return uniqueBonusNames(names).map((name) => ({ name, condition: "" }));
  }
  const prefixed = lines
    .filter((line) => /^bonus:\s+\S/i.test(line))
    .map((line) => line.replace(/^bonus:\s+/i, "").trim());
  return uniqueBonusNames(prefixed).map((name) => ({ name, condition: "" }));
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
    const plan = fromText.altPrices.find((row) => /\d{1,2}\s*cuotas?\s+de/i.test(row.label));
    if (plan?.amount) {
      const planName = `${plan.label} USD ${String(plan.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
      if (!commercial.paymentModes.some((row) => /cuota/i.test(`${row.name} ${row.details}`))) {
        commercial.paymentModes = [...commercial.paymentModes, { name: planName, details: "" }];
      }
    }
  } else {
    if (commercial.listPrice != null && !cited.has(Math.round(commercial.listPrice))) {
      commercial.listPrice = null;
    }
    commercial.altPrices = commercial.altPrices.filter(
      (row) => row.amount == null || cited.has(Math.round(row.amount)),
    );
  }

  const foundBonuses = bonusesFromOfferText(source);
  if (foundBonuses.length) {
    commercial.bonuses = foundBonuses;
  } else {
    commercial.bonuses = commercial.bonuses.filter((row) => {
      const name = row.name.trim().toLowerCase();
      return name.length >= 8 && source.toLowerCase().includes(name.slice(0, 40));
    });
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
