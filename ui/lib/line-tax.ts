// line-tax — the tax column of an invoice line (invoice#21).
//
// The line freezes the MAIN rate (`tax_rate`) and the equivalence surcharge (`surcharge_rate`)
// apart; the combined 26.2 that the sale charges is a sum, not a rate. Two generations coexist:
//   * legacy rows (before migration 006): `surcharge_rate` NULL, `tax_rate` may still be a sum.
//     A frozen fiscal row is never rewritten → painted exactly as it was frozen.
//   * new rows: `surcharge_rate` present (0 = none), `tax_rate` = main rate.

export interface LineTaxFields {
  tax_rate: number | string;
  surcharge_rate?: number | string | null;
}

const pct = (v: unknown) => `${Number(v || 0).toFixed(2)}%`;

/** `21.00%` · `21.00% + RE 5.20%` (label from `t('ui.taxSurcharge')`) · legacy `26.20%`. */
export function lineTaxLabel(line: LineTaxFields, t: (key: string) => string): string {
  const main = pct(line.tax_rate);
  if (line.surcharge_rate == null) return main; // legacy generation: shown as frozen
  const surcharge = Number(line.surcharge_rate) || 0;
  return surcharge > 0 ? `${main} + ${t('ui.taxSurcharge')} ${pct(surcharge)}` : main;
}
