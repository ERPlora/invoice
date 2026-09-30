// line-tax — the tax column of an invoice line (invoice#21).
//
// The line freezes the MAIN rate (`tax_rate`) and the equivalence surcharge (`surcharge_rate`)
// apart; the combined 26.2 that the sale charges is a sum, not a rate. Two generations coexist:
//   * legacy rows (before migration 006): `surcharge_rate` NULL, `tax_rate` may still be a sum.
//     A frozen fiscal row is never rewritten → painted exactly as it was frozen.
//   * new rows: `surcharge_rate` present (0 = none), `tax_rate` = main rate.

import { numberFormat } from './number-format';

export interface LineTaxFields {
  tax_rate: number | string;
  surcharge_rate?: number | string | null;
}

/** A rate in points (21 = 21 %) the way the language writes a percentage: «5,2 %» in es, «5.2%»
 *  in en, at most two decimals — the same text as OutfitKit's `formatPercent` on the lines of the
 *  paper (invoice#125, invoice#141). */
export function percentText(points: number, locale: string | undefined): string {
  return numberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(points / 100);
}

/** `21%` · `21% + RE 5.2%` (label from `t('ui.taxSurcharge')`) · legacy `26.2%` — written the way
 *  the person's language writes a percentage: «21 %», «5,2 %» in es (invoice#125). */
export function lineTaxLabel(line: LineTaxFields, t: (key: string) => string, locale: string | undefined): string {
  const pct = (v: unknown) => percentText(Number(v) || 0, locale);
  const main = pct(line.tax_rate);
  if (line.surcharge_rate == null) return main; // legacy generation: shown as frozen
  const surcharge = Number(line.surcharge_rate) || 0;
  return surcharge > 0 ? `${main} + ${t('ui.taxSurcharge')} ${pct(surcharge)}` : main;
}
